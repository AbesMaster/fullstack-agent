import { desc, ne } from "drizzle-orm";
import { db, requirePageUser } from "@/lib/server";
import { approvals } from "@/lib/db/schema";
import { listPendingApprovals } from "@/lib/agents/controls";
import { getAgent } from "@/lib/agents/registry";
import { Card } from "@/components/admin/Stat";
import { ApprovalButtons } from "@/components/admin/ApprovalButtons";

export default async function Page() {
  const user = await requirePageUser("dashboard.view");
  const d = await db();
  const pending = await listPendingApprovals(d);
  const decided = await d.select().from(approvals).where(ne(approvals.status, "pending")).orderBy(desc(approvals.decidedAt)).limit(30);
  const canDecide = user.role === "owner" || user.role === "admin";
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Approvals</h1>
      <p className="text-sm text-navy-800/70">Agents cannot publish, send marketing, spend money, issue refunds, change prices, book venues, sign agreements, export sensitive data or change access without your decision here.</p>
      <Card title={`Waiting (${pending.length})`}>
        {pending.length === 0 ? <p className="text-sm text-navy-800/60">Nothing to approve.</p> : (
          <ul className="divide-y divide-navy-900/10">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-lavender-deep">{p.action} · requested by {getAgent(p.agentId).name}</p>
                  <p className="font-medium">{p.summary}</p>
                  <p className="text-xs text-navy-800/60">{p.createdAt.toLocaleString("en-GB")}</p>
                </div>
                {canDecide ? <ApprovalButtons id={p.id} /> : <span className="text-sm text-navy-800/60">Owner/admin decision</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="History">
        <ul className="space-y-1 text-sm">
          {decided.map((p) => <li key={p.id}><span className={p.status === "approved" ? "text-navy-900" : "text-earth"}>{p.status}</span> — {p.action}: {p.summary} {p.decisionNote ? `(“${p.decisionNote}”)` : ""}</li>)}
        </ul>
      </Card>
    </div>
  );
}
