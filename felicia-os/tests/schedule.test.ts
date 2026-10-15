import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { harness, MONDAY, type Harness } from "./helpers";
import { requestBooking } from "@/lib/booking/booking";
import { aftercare, expireUnpaidHolds, morningBrief, periodReport, runDueJobs, sendReminders } from "@/lib/agents/schedule";
import { bookings } from "@/lib/db/schema";
import { setEmergencyStop } from "@/lib/agents/controls";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe("scheduled operations", () => {
  it("sends one reminder ~24h before, then aftercare after the session", async () => {
    const start = new Date("2026-01-06T10:00:00Z");
    await requestBooking(h.db, { serviceId: "discovery-call", startsAt: start, name: "Sched Test", email: "s@example.test", clientTimezone: "Europe/London", acceptedTerms: true }, "s1", MONDAY);
    await h.drainAll();
    const dayBefore = new Date(start.getTime() - 24 * 3600_000);
    expect((await sendReminders(h.db, dayBefore)).sent).toBe(1);
    expect((await sendReminders(h.db, dayBefore)).sent).toBe(0); // idempotent
    const after = new Date(start.getTime() + 2 * 3600_000);
    expect((await aftercare(h.db, after)).completed).toBe(1);
    const [b] = await h.db.select().from(bookings);
    expect(b!.status).toBe("completed");
    expect(h.email.outbox.some((m) => m.subject === "Thank you for our conversation")).toBe(true);
  });

  it("releases unpaid holds after the hold window", async () => {
    await requestBooking(h.db, { serviceId: "signature-private-session", startsAt: new Date("2026-01-07T10:00:00Z"), name: "Hold", email: "h@example.test", clientTimezone: "Europe/London", acceptedTerms: true }, "hold", MONDAY);
    expect((await expireUnpaidHolds(h.db, new Date(Date.now() + 10 * 60_000))).expired).toBe(0);
    expect((await expireUnpaidHolds(h.db, new Date(Date.now() + 31 * 60_000))).expired).toBe(1);
    const [b] = await h.db.select().from(bookings).where(eq(bookings.idempotencyKey, "hold"));
    expect(b!.status).toBe("cancelled");
  });

  it("reports keep actual, forecast and target separate", async () => {
    const r = await periodReport(h.db, "weekly");
    expect(r.lines[0]).toMatch(/^ACTUAL/);
    expect(r.lines[2]).toMatch(/^FORECAST/);
    expect(r.lines[3]).toMatch(/^TARGET/);
    expect((await morningBrief(h.db)).lines.length).toBeGreaterThan(2);
  });

  it("runs daily jobs once per day and halts under emergency stop", async () => {
    const at = new Date("2026-01-05T09:30:00Z");
    const first = await runDueJobs(h.db, at);
    expect(first).toHaveProperty("report:daily_brief");
    const second = await runDueJobs(h.db, at);
    expect(second).not.toHaveProperty("report:daily_brief");
    await setEmergencyStop(h.db, true, "user:t", "drill");
    expect(await runDueJobs(h.db, at)).toEqual({ halted: true });
  });
});
