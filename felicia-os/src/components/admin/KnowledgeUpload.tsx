"use client";
import { useState } from "react";

export function KnowledgeUpload({ sections, docs }: { sections: Record<string, string>; docs: { id: string; title: string }[] }) {
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("Uploading…");
    const r = await fetch("/api/admin/knowledge", { method: "POST", body: new FormData(e.currentTarget) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Saved (v${j.version}${j.unchanged ? ", unchanged" : `, ${j.chunks} passages`})` : (j.error ?? "Failed"));
    if (r.ok) setTimeout(() => window.location.reload(), 800);
  }
  const input = "mt-1 w-full rounded-lg border border-navy-900/20 px-3 py-2 text-sm";
  return (
    <form method="post" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <label className="text-xs">Title<input name="title" required maxLength={200} className={input} /></label>
      <label className="text-xs">Section<select name="section" className={input}>{Object.entries(sections).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</select></label>
      <label className="text-xs">Verification<select name="verificationStatus" className={input}><option value="draft">Draft</option><option value="assumption">Assumption</option><option value="verified">Verified fact</option></select></label>
      <label className="text-xs">Access<select name="accessLevel" className={input}><option value="internal">Internal</option><option value="public">Public (website assistant may use)</option><option value="restricted">Restricted</option></select></label>
      <label className="text-xs">Replaces (new version of)<select name="replacesDocumentId" className={input}><option value="">— new document —</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
      <label className="text-xs">File (PDF, DOCX, TXT, MD, CSV, JSON)<input name="file" type="file" accept=".pdf,.docx,.txt,.md,.csv,.json" className={input} /></label>
      <label className="text-xs md:col-span-2">…or a page from your own website<input name="url" type="url" placeholder="https://…" className={input} /></label>
      <label className="text-xs md:col-span-2">…or paste text<textarea name="text" rows={4} className={input} /></label>
      <div className="md:col-span-2"><button className="rounded-full bg-navy-900 px-4 py-2 text-sm text-ivory">Save to knowledge base</button> <span role="status" className="ml-2 text-sm">{msg}</span></div>
    </form>
  );
}
