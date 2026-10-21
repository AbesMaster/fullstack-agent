import { describe, it, expect, beforeEach } from "vitest";
import { harness, MONDAY, type Harness } from "./helpers";
import { commandOverview } from "@/lib/command/overview";
import { agentTasks, approvals } from "@/lib/db/schema";
import { createEnquiry, requestBooking } from "@/lib/booking/booking";
import { applyPaymentEvent } from "@/lib/payments/processing";
import { setEmergencyStop } from "@/lib/agents/controls";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe("JARVIS command overview", () => {
  it("reports real activity per department, hides money without finance access and never exposes client details", async () => {
    const now = new Date();
    await createEnquiry(h.db, { name: "Private Person", email: "private@example.test", message: "My private message", marketingConsent: false }, "cmd1");
    const { bookingId } = await requestBooking(h.db, { serviceId: "signature-private-session", startsAt: new Date("2026-01-06T10:00:00Z"), name: "Private Person", email: "private@example.test", clientTimezone: "Europe/London", acceptedTerms: true }, "cmd2", MONDAY);
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "cmd-e1", providerRef: "pi_cmd", reference: bookingId, amountMinor: 33300, feeMinor: 500, currency: "GBP" });
    await h.drainAll();
    await h.db.insert(agentTasks).values([
      { id: "tsk_c1", agentId: "finance", kind: "monthly_report", status: "succeeded", createdAt: new Date(now.getTime() - 3600_000) },
      { id: "tsk_c2", agentId: "finance", kind: "budget_check", status: "failed", createdAt: new Date(now.getTime() - 7200_000) },
      { id: "tsk_old", agentId: "finance", kind: "old", status: "succeeded", createdAt: new Date(now.getTime() - 3 * 86400_000) },
    ]);
    await h.db.insert(approvals).values({ id: "apr_c1", action: "money.spend", agentId: "growth", summary: "Ad test", payload: {} });

    const full = await commandOverview(h.db, { includeMoney: true });
    const finance = full.streams.find((s) => s.department === "Financial Intelligence")!;
    expect(finance.tasks24).toBe(2); // the 3-day-old task is excluded
    expect(finance.needsAttention).toBe(1);
    expect(finance.hourly.reduce((a, b) => a + b, 0)).toBe(2);
    expect(finance.metric.value).toBe("£333");
    expect(full.top.revenueMonthMinor).toBe(33300);
    expect(full.top.approvalsWaiting).toBe(1);
    expect(full.top.enquiriesToday).toBeGreaterThanOrEqual(1);
    // The test booking is on 6 January 2026; seen from the day before, it is a session booked ahead.
    const before = await commandOverview(h.db, { includeMoney: false, now: MONDAY });
    expect(before.streams.find((s) => s.department === "Business Operations")!.metric.value).toBe("1");
    expect(full.streams).toHaveLength(6);
    expect(full.streams.reduce((n, s) => n + s.agents.length, 0)).toBe(full.top.agents);

    const json = JSON.stringify(full);
    expect(json).not.toContain("private@example.test");
    expect(json).not.toContain("Private Person");
    expect(json).not.toContain("My private message");

    const limited = await commandOverview(h.db, { includeMoney: false });
    expect(limited.top.revenueMonthMinor).toBeNull();
    expect(limited.streams.find((s) => s.department === "Financial Intelligence")!.metric.value).toBe("—");
  });

  it("shows when automation is paused", async () => {
    await setEmergencyStop(h.db, true, "user:owner", "test");
    expect((await commandOverview(h.db, { includeMoney: false })).state).toBe("paused");
  });
});
