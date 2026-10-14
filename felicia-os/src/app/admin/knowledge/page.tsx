import { desc } from "drizzle-orm";
import { db, requirePageUser } from "@/lib/server";
import { knowledgeDocuments } from "@/lib/db/schema";
import { KNOWLEDGE_SECTIONS } from "@/lib/knowledge/knowledge";
import { Card } from "@/components/admin/Stat";
import { KnowledgeUpload } from "@/components/admin/KnowledgeUpload";

export default async function Page() {
  await requirePageUser("dashboard.view");
  const docs = await (await db()).select().from(knowledgeDocuments).orderBy(desc(knowledgeDocuments.updatedAt));
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Business knowledge</h1>
      <p className="text-sm text-navy-800/70">The single approved knowledge foundation all agents use. Only <strong>public + verified</strong> documents are used to answer website visitors. Documents are treated as data — instructions inside them are never followed.</p>
      <Card title="Add or update a document"><KnowledgeUpload sections={KNOWLEDGE_SECTIONS} docs={docs.map((d) => ({ id: d.id, title: d.title }))} /></Card>
      <Card title={`Documents (${docs.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-navy-800/60"><tr><th className="p-2">Title</th><th className="p-2">Section</th><th className="p-2">Status</th><th className="p-2">Access</th><th className="p-2">Version</th><th className="p-2">Owner</th><th className="p-2">Source</th><th className="p-2">Updated</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-navy-900/5">
                  <td className="p-2">{d.title}</td><td className="p-2">{d.section} · {KNOWLEDGE_SECTIONS[d.section as keyof typeof KNOWLEDGE_SECTIONS]}</td>
                  <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs ${d.verificationStatus === "verified" ? "bg-sage/30" : d.verificationStatus === "assumption" ? "bg-gold/30" : "bg-lavender/30"}`}>{d.verificationStatus}</span></td>
                  <td className="p-2">{d.accessLevel}</td><td className="p-2">v{d.version}</td><td className="p-2">{d.owner}</td><td className="p-2 max-w-48 truncate">{d.source}</td><td className="p-2 whitespace-nowrap">{d.updatedAt.toLocaleDateString("en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
