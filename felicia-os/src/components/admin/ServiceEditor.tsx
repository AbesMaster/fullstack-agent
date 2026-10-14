"use client";
import { useState } from "react";

type S = { id: string; name: string; description: string; durationMinutes: number | null; priceMinor: number; priceMaxMinor: number | null; capacity: number; status: string; cancellationTerms: string; ownerApprovedPrice: boolean };

export function ServiceEditor({ s, canEdit }: { s: S; canEdit: boolean }) {
  const [msg, setMsg] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pounds = (k: string) => (f.get(k) === "" ? null : Math.round(Number(f.get(k)) * 100));
    const r = await fetch(`/api/admin/services`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: s.id, patch: { name: f.get("name"), description: f.get("description"), durationMinutes: f.get("duration") === "" ? null : Number(f.get("duration")), priceMinor: pounds("price"), priceMaxMinor: pounds("priceMax"), capacity: Number(f.get("capacity")), status: f.get("status"), cancellationTerms: f.get("terms") } }),
    });
    setMsg(r.ok ? "Saved" : ((await r.json().catch(() => ({}))).error ?? "Failed"));
  }
  const input = "mt-1 w-full rounded-lg border border-navy-900/20 px-3 py-2 text-sm disabled:bg-ivory";
  return (
    <form method="post" onSubmit={save} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <code className="text-xs text-navy-800/60">{s.id}</code>
        <span className={`rounded-full px-2 py-0.5 text-xs ${s.ownerApprovedPrice ? "bg-sage/30" : "bg-gold/30"}`}>{s.ownerApprovedPrice ? "price approved" : "price proposed"}</span>
      </div>
      <fieldset disabled={!canEdit} className="space-y-3">
        <label className="block text-xs">Name<input name="name" defaultValue={s.name} className={input} /></label>
        <label className="block text-xs">Description<textarea name="description" defaultValue={s.description} rows={3} className={input} /></label>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="block text-xs">Price £<input name="price" type="number" step="0.01" min="0" defaultValue={s.priceMinor / 100} className={input} /></label>
          <label className="block text-xs">Max £ (range)<input name="priceMax" type="number" step="0.01" min="0" defaultValue={s.priceMaxMinor != null ? s.priceMaxMinor / 100 : ""} className={input} /></label>
          <label className="block text-xs">Minutes<input name="duration" type="number" min="5" defaultValue={s.durationMinutes ?? ""} className={input} /></label>
          <label className="block text-xs">Capacity<input name="capacity" type="number" min="1" defaultValue={s.capacity} className={input} /></label>
        </div>
        <label className="block text-xs">Status
          <select name="status" defaultValue={s.status} className={input}>
            <option value="proposed">Proposed (visible, price being finalised)</option>
            <option value="active">Active (price approved)</option>
            <option value="paused">Paused (hidden)</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="block text-xs">Cancellation terms<textarea name="terms" defaultValue={s.cancellationTerms} rows={2} className={input} /></label>
        {canEdit && <button className="rounded-full bg-navy-900 px-4 py-2 text-sm text-ivory">Save</button>}
        {msg && <span role="status" className="ml-3 text-sm">{msg}</span>}
      </fieldset>
    </form>
  );
}
