import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { agentTasks, approvals } from "../db/schema";
import { getSetting, setSetting } from "../settings";
import { audit } from "../audit/audit";
import { newId } from "../util";
import { APPROVAL_REQUIRED_ACTIONS, getAgent, type ApprovalAction, type Tool } from "./registry";

export class PermissionDenied extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PermissionDenied";
  }
}

/* ---------------- Emergency stop ---------------- */

export async function isEmergencyStopped(db: DB): Promise<boolean> {
  return (await getSetting<{ engaged: boolean }>(db, "emergency_stop", { engaged: false })).engaged;
}

export async function setEmergencyStop(db: DB, engaged: boolean, actor: string, reason: string) {
  await setSetting(db, "emergency_stop", { engaged, reason, at: new Date().toISOString() }, actor);
  await audit(db, { actor, action: engaged ? "emergency_stop.engaged" : "emergency_stop.released", metadata: { reason } });
}

/* ---------------- Tool permissions ---------------- */

/** Throws unless the agent's static definition includes the tool. Agents cannot modify their definitions at runtime. */
export function assertTool(agentId: string, tool: Tool) {
  const agent = getAgent(agentId);
  if (!agent.tools.includes(tool)) throw new PermissionDenied(`${agent.name} is not permitted to use ${tool}`);
}

export const isApprovalAction = (a: string): a is ApprovalAction => (APPROVAL_REQUIRED_ACTIONS as readonly string[]).includes(a);

/* ---------------- Approvals ---------------- */

/**
 * The ONLY path for an agent to cause an approval-gated effect. It records a
 * pending approval; the effect runs later via executeApproved() once a human approves.
 */
export async function requestApproval(db: DB, agentId: string, action: ApprovalAction, summary: string, payload: Record<string, unknown>) {
  const agent = getAgent(agentId);
  if (!agent.mayRequest.includes(action)) throw new PermissionDenied(`${agent.name} may not request ${action}`);
  if (await isEmergencyStopped(db)) throw new PermissionDenied("Emergency stop is engaged");
  const id = newId("apr");
  await db.insert(approvals).values({ id, action, agentId, summary, payload });
  await audit(db, { actor: `agent:${agentId}`, action: "approval.requested", target: id, metadata: { action, summary } });
  return id;
}

export async function decideApproval(
  db: DB,
  approvalId: string,
  decision: "approved" | "rejected",
  user: { id: string; role: string },
  note?: string,
) {
  if (user.role !== "owner" && user.role !== "admin") throw new PermissionDenied("Only the owner or an admin can decide approvals");
  const updated = await db
    .update(approvals)
    .set({ status: decision, decidedBy: user.id, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning();
  if (!updated[0]) throw new Error("Approval not found or already decided");
  await audit(db, { actor: `user:${user.id}`, action: `approval.${decision}`, target: approvalId, metadata: { note } });
  return updated[0];
}

export async function listPendingApprovals(db: DB) {
  return db.select().from(approvals).where(eq(approvals.status, "pending")).orderBy(desc(approvals.createdAt));
}

/* ---------------- Task history + rate limits ---------------- */

export async function recordTask<T>(
  db: DB,
  agentId: string,
  kind: string,
  correlationId: string | undefined,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const agent = getAgent(agentId);
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentTasks)
    .where(and(eq(agentTasks.agentId, agentId), gte(agentTasks.createdAt, since)));
  const id = newId("tsk");
  if (n >= agent.limits.tasksPerHour) {
    await db.insert(agentTasks).values({ id, agentId, kind, status: "blocked", correlationId, input: input as never, error: "Hourly task limit reached" });
    throw new PermissionDenied(`${agent.name} hit its hourly task limit`);
  }
  await db.insert(agentTasks).values({ id, agentId, kind, status: "running", correlationId, input: input as never, startedAt: new Date() });
  try {
    const out = await fn();
    await db.update(agentTasks).set({ status: "succeeded", output: (out ?? null) as never, finishedAt: new Date() }).where(eq(agentTasks.id, id));
    return out;
  } catch (err) {
    await db.update(agentTasks).set({ status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() }).where(eq(agentTasks.id, id));
    throw err;
  }
}
