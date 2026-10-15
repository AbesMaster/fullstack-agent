"use client";
import { useState } from "react";

export function ContentComposer({ categories, channels }: { categories: string[]; channels: string[] }) {
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await fetch("/api/admin/content", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "draft", draft: Object.fromEntries(f) }) });
    setMsg(r.ok ? "Draft saved" : "Please check the fields");
    if (r.ok) window.location.reload();
  }
  const input = "mt-1 w-full rounded-lg border border-navy-900/20 px-3 py-2 text-sm";
  return (
    <form method="post" onSubmit={submit} className="grid gap-3 md:grid-cols-3">
      <label className="text-xs">Channel<select name="channel" className={input}>{channels.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="text-xs">Category<select name="category" className={input}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="text-xs">Format<select name="format" className={input}>{["caption", "short_script", "carousel", "email", "landing_copy", "brief"].map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="text-xs md:col-span-3">Title<input name="title" required maxLength={200} className={input} /></label>
      <label className="text-xs md:col-span-3">Body<textarea name="body" required rows={5} className={input} /></label>
      <div><button className="rounded-full bg-navy-900 px-4 py-2 text-sm text-ivory">Save draft</button> <span className="text-sm">{msg}</span></div>
    </form>
  );
}

export function SubmitContentButton({ id }: { id: string }) {
  return (
    <button
      className="rounded-full border border-navy-900/30 px-3 py-1 text-xs"
      onClick={async () => {
        const r = await fetch("/api/admin/content", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "submit", id }) });
        const j = await r.json().catch(() => ({}));
        alert(j.status === "rejected" ? "Blocked by compliance review — see the flags and revise." : r.ok ? "Sent for approval" : (j.error ?? "Failed"));
        window.location.reload();
      }}
    >
      Submit for approval
    </button>
  );
}
