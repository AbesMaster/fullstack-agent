import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { harness, type Harness } from "./helpers";
import { EventBus, MAX_ATTEMPTS, backoffMs, publish, retryDeadLetter } from "@/lib/events/bus";
import { agentTasks, domainEvents, enquiries } from "@/lib/db/schema";
import { assertTool, PermissionDenied, recordTask, requestApproval, setEmergencyStop } from "@/lib/agents/controls";
import { AGENTS, APPROVAL_REQUIRED_ACTIONS } from "@/lib/agents/registry";
import { createEnquiry } from "@/lib/booking/booking";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe("event bus", () => {
  it("drops duplicate idempotency keys", async () => {
    const a = await publish(h.db, "BUDGET_ALERT", { rule: "r", message: "m" }, { correlationId: "c", idempotencyKey: "k" });
    const b = await publish(h.db, "BUDGET_ALERT", { rule: "r", message: "m" }, { correlationId: "c", idempotencyKey: "k" });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
  });

  it("validates payloads against the typed schema", async () => {
    await expect(publish(h.db, "BOOKING_CONFIRMED", { nope: 1 } as never, { correlationId: "c", idempotencyKey: "x" })).rejects.toThrow();
  });

  it("retries with backoff, re-runs only failed handlers, and dead-letters after max attempts", async () => {
    const bus = new EventBus();
    let okRuns = 0;
    let badRuns = 0;
    bus.register({ name: "ok", agentId: "finance", on: "BUDGET_ALERT", run: async () => void okRuns++ });
    bus.register({ name: "bad", agentId: "finance", on: "BUDGET_ALERT", run: async () => { badRuns++; throw new Error("boom"); } });
    await publish(h.db, "BUDGET_ALERT", { rule: "r", message: "m" }, { correlationId: "c", idempotencyKey: "k2" });
    let now = new Date();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await bus.drain(h.db, { now });
      now = new Date(now.getTime() + backoffMs(i + 1) + 1000);
    }
    expect(okRuns).toBe(1); // exactly-once despite retries
    expect(badRuns).toBe(MAX_ATTEMPTS);
    const [evt] = await h.db.select().from(domainEvents);
    expect(evt!.status).toBe("dead");
    await retryDeadLetter(h.db, evt!.id, "user:test");
    expect((await h.db.select().from(domainEvents))[0]!.status).toBe("pending");
  });

  it("processes nothing while the emergency stop is engaged", async () => {
    await publish(h.db, "BUDGET_ALERT", { rule: "r", message: "m" }, { correlationId: "c", idempotencyKey: "k3" });
    await setEmergencyStop(h.db, true, "user:test", "drill");
    expect((await h.bus.drain(h.db)).halted).toBe(true);
    await setEmergencyStop(h.db, false, "user:test", "drill over");
    expect((await h.bus.drain(h.db)).halted).toBe(false);
  });
});

describe("agent permissions", () => {
  it("defines the commander plus 20 specialist agents with unique ids", () => {
    expect(AGENTS).toHaveLength(21);
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(21);
  });

  it("no agent holds an approval-gated tool directly", () => {
    const gated = ["payments.refund", "email.sendMarketing", "content.publish", "ads.launch", "site.production"];
    for (const a of AGENTS) for (const t of gated) expect(a.tools).not.toContain(t);
  });

  it("enforces tool allow-lists and requestable actions", async () => {
    expect(() => assertTool("client-conversation", "payments.createCheckout")).toThrow(PermissionDenied);
    expect(() => assertTool("payments", "payments.createCheckout")).not.toThrow();
    await expect(requestApproval(h.db, "content-strategy", "content.publish", "x", {})).rejects.toBeInstanceOf(PermissionDenied);
    await expect(requestApproval(h.db, "social-ops", "content.publish", "x", {})).resolves.toMatch(/^apr_/);
    expect(APPROVAL_REQUIRED_ACTIONS).toContain("venue.book");
  });

  it("blocks approval requests during an emergency stop", async () => {
    await setEmergencyStop(h.db, true, "user:test", "drill");
    await expect(requestApproval(h.db, "social-ops", "content.publish", "x", {})).rejects.toThrow(/Emergency stop/);
  });

  it("enforces per-agent hourly task limits and records history", async () => {
    const lim = AGENTS.find((a) => a.id === "website-dev")!.limits.tasksPerHour;
    for (let i = 0; i < lim; i++) await recordTask(h.db, "website-dev", "t", undefined, {}, async () => i);
    await expect(recordTask(h.db, "website-dev", "t", undefined, {}, async () => 0)).rejects.toThrow(/limit/);
    const rows = await h.db.select().from(agentTasks).where(eq(agentTasks.agentId, "website-dev"));
    expect(rows.filter((r) => r.status === "succeeded")).toHaveLength(lim);
    expect(rows.filter((r) => r.status === "blocked")).toHaveLength(1);
  });
});

describe("lead workflow", () => {
  it("NEW LEAD → CRM → qualification → welcome email → sales follow-up task", async () => {
    await createEnquiry(h.db, { name: "Fictional Lead", email: "Lead@Example.test", message: "What does a session cost and when are you available?", marketingConsent: false }, "lead-1");
    await h.drainAll();
    expect(h.crm.contacts.get("lead@example.test")).toBeTruthy();
    const [e] = await h.db.select().from(enquiries);
    expect(e!.status).toBe("qualified");
    expect(e!.bookingIntent).toBe("high");
    expect(h.email.outbox[0]!.subject).toBe("Thank you for reaching out");
    const tasks = await h.db.select().from(agentTasks).where(eq(agentTasks.kind, "follow_up_draft"));
    expect(tasks).toHaveLength(1);
  });

  it("escalates sensitive enquiries to Felicia instead of auto-qualifying", async () => {
    await createEnquiry(h.db, { name: "Fictional", email: "x@example.test", message: "I take medication for my heart condition, is breathwork safe?" }, "lead-2");
    await h.drainAll();
    const [e] = await h.db.select().from(enquiries);
    expect(e!.status).toBe("escalated");
    const owner = await h.db.select().from(agentTasks).where(eq(agentTasks.kind, "owner_attention"));
    expect(owner).toHaveLength(1);
  });
});
