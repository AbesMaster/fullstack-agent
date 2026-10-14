import { desc, eq, sql } from "drizzle-orm";
import { db, requirePageUser } from "@/lib/server";
import { AGENTS } from "@/lib/agents/registry";
import { agentTasks, domainEvents } from "@/lib/db/schema";
import { Card } from "@/components/admin/Stat";

export default async function Page() {
  await requirePageUser("dashboard.view");
  const d = await db();
  const stats = await d
    .select({ agentId: agentTasks.agentId, status: agentTasks.status, n: sql<number>`count(*)::int` })
    .from(agentTasks)
    .groupBy(agentTasks.agentId, agentTasks.status);
  const dead = await d.select().from(domainEvents).where(eq(domainEvents.status, "dead")).orderBy(desc(domainEvents.createdAt)).limit(20);
  const recent = await d.select().from(agentTasks).orderBy(desc(agentTasks.createdAt)).limit(25);
  const count = (id: string, s: string) => stats.find((x) => x.agentId === id && x.status === s)?.n ?? 0;
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Agents</h1>
      <p className="text-sm text-navy-800/70">Each agent has a fixed role, tool allow-list, approval boundaries and hourly limits defined in code. Agents cannot change their own permissions.</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((a) => (
          <Card key={a.id} title={`${a.number.toString().padStart(2, "0")} · ${a.name}`}>
            <p className="text-xs uppercase tracking-wider text-lavender-deep">{a.department}</p>
            <p className="mt-1 text-sm">{a.mission}</p>
            <p className="mt-3 text-xs text-navy-800/70"><strong>Tools:</strong> {a.tools.join(", ")}</p>
            {a.mayRequest.length > 0 && <p className="mt-1 text-xs text-navy-800/70"><strong>Needs approval for:</strong> {a.mayRequest.join(", ")}</p>}
            <p className="mt-1 text-xs text-navy-800/70"><strong>Limits:</strong> {a.limits.tasksPerHour} tasks/hour</p>
            <p className="mt-3 text-sm">✓ {count(a.id, "succeeded")} · ✗ {count(a.id, "failed")} · ⏸ {count(a.id, "blocked")} · queued {count(a.id, "queued")}</p>
          </Card>
        ))}
      </div>
      <Card title={`Dead-lettered workflow events (${dead.length})`}>
        {dead.length === 0 ? <p className="text-sm text-navy-800/60">None.</p> : <ul className="space-y-1 text-sm">{dead.map((e) => <li key={e.id}><code>{e.type}</code> — {e.lastError}</li>)}</ul>}
      </Card>
      <Card title="Recent activity">
        <ul className="space-y-1 text-sm">
          {recent.map((t) => <li key={t.id}><span className="text-navy-800/60">{t.createdAt.toLocaleString("en-GB")}</span> · {t.agentId} · {t.kind} · <strong>{t.status}</strong>{t.error ? ` — ${t.error}` : ""}</li>)}
        </ul>
      </Card>
    </div>
  );
}
