import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { domainEvents, handlerReceipts } from "../db/schema";
import { newId } from "../util";
import { audit } from "../audit/audit";
import { EventSchemas, type DomainEvent, type EventPayload, type EventType } from "./types";
import { isEmergencyStopped } from "../agents/controls";

export const MAX_ATTEMPTS = 5;

/** Exponential backoff with cap: 2s, 4s, 8s, 16s, … (max 15 min). */
export const backoffMs = (attempt: number) => Math.min(2000 * 2 ** (attempt - 1), 15 * 60 * 1000);

/**
 * Publish to the transactional outbox. Duplicate idempotency keys are ignored, so
 * replayed webhooks or double-clicked forms never produce duplicate downstream work.
 * Returns the event id, or null when the key was already used.
 */
export async function publish<T extends EventType>(
  db: DB,
  type: T,
  payload: EventPayload<T>,
  opts: { correlationId: string; idempotencyKey: string },
): Promise<string | null> {
  const parsed = EventSchemas[type].parse(payload);
  const id = newId("evt");
  const inserted = await db
    .insert(domainEvents)
    .values({ id, type, payload: parsed, correlationId: opts.correlationId, idempotencyKey: `${type}:${opts.idempotencyKey}` })
    .onConflictDoNothing()
    .returning({ id: domainEvents.id });
  return inserted[0]?.id ?? null;
}

export type Handler<T extends EventType = EventType> = {
  /** Stable name; used for exactly-once receipts. */
  name: string;
  /** Agent that owns this step (for permissions, task history and metrics). */
  agentId: string;
  on: T;
  run: (db: DB, event: DomainEvent<T>) => Promise<unknown>;
};

export class EventBus {
  private handlers = new Map<EventType, Handler[]>();

  register<T extends EventType>(h: Handler<T>) {
    const list = this.handlers.get(h.on) ?? [];
    list.push(h as unknown as Handler);
    this.handlers.set(h.on, list);
    return this;
  }

  handlersFor(type: EventType) {
    return this.handlers.get(type) ?? [];
  }

  /**
   * Process due events. Each handler runs at most once per event (handler_receipts),
   * so a retry after a partial failure only re-runs the handlers that failed.
   * Honours the emergency stop: nothing is processed while it is engaged.
   */
  async drain(db: DB, opts: { now?: Date; limit?: number } = {}): Promise<{ processed: number; failed: number; dead: number; halted: boolean }> {
    if (await isEmergencyStopped(db)) return { processed: 0, failed: 0, dead: 0, halted: true };
    const now = opts.now ?? new Date();
    const due = await db
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.status, "pending"), lte(domainEvents.nextAttemptAt, now)))
      .orderBy(asc(domainEvents.createdAt))
      .limit(opts.limit ?? 50);

    let processed = 0;
    let failed = 0;
    let dead = 0;

    for (const row of due) {
      // Claim (guards against concurrent workers).
      const claimed = await db
        .update(domainEvents)
        .set({ status: "processing", attempts: sql`${domainEvents.attempts} + 1` })
        .where(and(eq(domainEvents.id, row.id), eq(domainEvents.status, "pending")))
        .returning({ attempts: domainEvents.attempts });
      if (!claimed[0]) continue;
      const attempts = claimed[0].attempts;
      const event: DomainEvent = { id: row.id, type: row.type as EventType, payload: row.payload as never, correlationId: row.correlationId, attempts };

      const errors: string[] = [];
      for (const h of this.handlersFor(event.type)) {
        const [done] = await db
          .select()
          .from(handlerReceipts)
          .where(and(eq(handlerReceipts.eventId, event.id), eq(handlerReceipts.handler, h.name)));
        if (done) continue;
        try {
          await h.run(db, event);
          await db.insert(handlerReceipts).values({ eventId: event.id, handler: h.name }).onConflictDoNothing();
        } catch (err) {
          errors.push(`${h.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (errors.length === 0) {
        await db.update(domainEvents).set({ status: "done", lastError: null }).where(eq(domainEvents.id, row.id));
        processed++;
      } else if (attempts >= MAX_ATTEMPTS) {
        await db.update(domainEvents).set({ status: "dead", lastError: errors.join(" | ") }).where(eq(domainEvents.id, row.id));
        await audit(db, { actor: "system", action: "event.dead_lettered", target: row.id, correlationId: row.correlationId, metadata: { type: row.type, errors } });
        dead++;
      } else {
        await db
          .update(domainEvents)
          .set({ status: "pending", lastError: errors.join(" | "), nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) })
          .where(eq(domainEvents.id, row.id));
        failed++;
      }
    }
    return { processed, failed, dead, halted: false };
  }
}

/** Requeue a dead-lettered event after a human has fixed the cause. */
export async function retryDeadLetter(db: DB, eventId: string, actor: string) {
  await db
    .update(domainEvents)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date() })
    .where(and(eq(domainEvents.id, eventId), eq(domainEvents.status, "dead")));
  await audit(db, { actor, action: "event.dead_letter_retried", target: eventId });
}
