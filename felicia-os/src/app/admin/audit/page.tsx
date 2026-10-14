import { desc } from "drizzle-orm";
import { db, requirePageUser } from "@/lib/server";
import { auditLog } from "@/lib/db/schema";

export default async function Page() {
  await requirePageUser("finance.view");
  const rows = await (await db()).select().from(auditLog).orderBy(desc(auditLog.at)).limit(200);
  return (
    <div className="space-y-4">
      <h1 className="text-4xl">Audit log</h1>
      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-ivory text-xs uppercase text-navy-800/60"><tr><th className="p-3">When</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Target</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id} className="border-t border-navy-900/5"><td className="p-3 whitespace-nowrap">{r.at.toLocaleString("en-GB")}</td><td className="p-3">{r.actor}</td><td className="p-3">{r.action}</td><td className="p-3"><code className="text-xs">{r.target}</code></td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
