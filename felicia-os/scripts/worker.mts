/**
 * Background worker: drains the event outbox every 15 s and runs scheduled
 * operations every 5 min. In production run it as a separate process (or replace
 * with a platform scheduler calling POST /api/cron/drain).
 */
import { createDb, migrate } from "../src/lib/db/client.ts";
import { buildBus } from "../src/lib/agents/workflows.ts";
import { runDueJobs } from "../src/lib/agents/schedule.ts";

const db = await createDb();
await migrate(db);
const bus = buildBus();
let lastJobs = 0;
console.log("FELICIA OS worker started.");
for (;;) {
  try {
    const r = await bus.drain(db, { limit: 100 });
    if (r.processed || r.failed || r.dead) console.log(new Date().toISOString(), "events", r);
    if (Date.now() - lastJobs > 5 * 60_000) {
      lastJobs = Date.now();
      console.log(new Date().toISOString(), "jobs", JSON.stringify(await runDueJobs(db)));
    }
  } catch (err) {
    console.error("worker error", err instanceof Error ? err.message : err);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
