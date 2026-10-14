import { desc } from "drizzle-orm";
import { db, requirePageUser } from "@/lib/server";
import { contentItems } from "@/lib/db/schema";
import { CONTENT_CATEGORIES, CHANNELS } from "@/lib/content/pipeline";
import { Card } from "@/components/admin/Stat";
import { ContentComposer, SubmitContentButton } from "@/components/admin/ContentComposer";

export default async function Page() {
  await requirePageUser("content.manage");
  const items = await (await db()).select().from(contentItems).orderBy(desc(contentItems.updatedAt)).limit(100);
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Marketing content</h1>
      <p className="text-sm text-navy-800/70">Pipeline: draft → automatic compliance review → your approval → publish (via platform API when connected, otherwise a ready-to-post pack). Nothing is published without approval.</p>
      <Card title="New draft"><ContentComposer categories={[...CONTENT_CATEGORIES]} channels={[...CHANNELS]} /></Card>
      <Card title="Pipeline">
        <ul className="divide-y divide-navy-900/10">
          {items.map((c) => (
            <li key={c.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p><span className="text-xs uppercase tracking-wider text-lavender-deep">{c.channel} · {c.format} · {c.category}</span><br /><strong>{c.title}</strong></p>
                <div className="flex items-center gap-3"><span className="rounded-full bg-ivory px-3 py-1 text-xs">{c.status.replace("_", " ")}</span>{(c.status === "draft" || c.status === "rejected") && <SubmitContentButton id={c.id} />}</div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-navy-800/80">{c.body}</p>
              {c.complianceFlags.length > 0 && <ul className="mt-2 space-y-1 text-xs text-earth">{c.complianceFlags.map((f) => <li key={f}>⚠ {f}</li>)}</ul>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
