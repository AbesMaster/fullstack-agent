import type { DB } from "../db/client";
import { auditLog } from "../db/schema";
import { newId } from "../util";

export type AuditEntry = {
  actor: string;
  action: string;
  target?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

/** Append-only audit trail. Never store secrets or sensitive health data in metadata. */
export async function audit(db: DB, e: AuditEntry) {
  await db.insert(auditLog).values({
    id: newId("aud"),
    actor: e.actor,
    action: e.action,
    target: e.target,
    correlationId: e.correlationId,
    metadata: e.metadata ?? null,
  });
}
