"use client";
import { useState } from "react";

type Initial = { id: string; title: string; description: string; location: string; startsAt: string; endsAt: string; capacity: number; priceMinor: number; budgetMinor: number; includesBreathwork: boolean; isOnline: boolean; status: string };

async function post(body: unknown) {
  const r = await fetch("/api/admin/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

export function EventEditor({ mode, initial }: { mode: "create" | "edit"; initial?: Initial }) {
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = {
      title: f.get("title"),
      description: f.get("description") ?? "",
      location: f.get("location"),
      // Sent as UK wall-clock values; the server converts them, whatever time zone this browser is in.
      startsAtLocal: f.get("startsAt"),
      endsAtLocal: f.get("endsAt"),
      capacity: Number(f.get("capacity")),
      priceMinor: Math.round(Number(f.get("price")) * 100),
      budgetMinor: Math.round(Number(f.get("budget") || 0) * 100),
      includesBreathwork: f.get("breathwork") === "on",
      isOnline: f.get("online") === "on",
      status: f.get("status"),
    };
    setMsg("Saving…");
    const { ok, j } = mode === "create" ? await post({ action: "create", event: values }) : await post({ action: "update", id: initial!.id, patch: values });
    if (!ok) return setMsg(j.issues?.[0]?.message ?? j.error ?? "Please check the fields");
    if (j.event?.videoWarning) return setMsg(`Saved, but Zoom wasn't updated: ${j.event.videoWarning}. Check the meeting in Zoom.`);
    if (mode === "create") window.location.href = `/admin/events/${j.id}`;
    else {
      setMsg("Saved");
      window.location.reload();
    }
  }
  const input = "mt-1 w-full rounded-lg border border-navy-900/20 px-3 py-2 text-sm";
  const v = initial;
  const p = mode === "create" ? "new" : "edit";
  return (
    <form method="post" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <label className="text-xs md:col-span-2">Title<input id={`${p}-title`} name="title" required minLength={3} maxLength={160} defaultValue={v?.title} className={input} /></label>
      <label className="text-xs md:col-span-2">Description (shown on the public page)<textarea id={`${p}-description`} name="description" rows={4} maxLength={5000} defaultValue={v?.description} className={input} /></label>
      <label className="text-xs md:col-span-2">Location (venue and town, or "Online (Zoom)")<input id={`${p}-location`} name="location" required maxLength={300} defaultValue={v?.location} className={input} /></label>
      <label className="text-xs">Starts (UK time)<input id={`${p}-starts`} name="startsAt" type="datetime-local" required defaultValue={v?.startsAt} className={input} /></label>
      <label className="text-xs">Ends (UK time)<input id={`${p}-ends`} name="endsAt" type="datetime-local" required defaultValue={v?.endsAt} className={input} /></label>
      <label className="text-xs">Places<input id={`${p}-capacity`} name="capacity" type="number" min={1} max={500} required defaultValue={v?.capacity ?? 12} className={input} /></label>
      <label className="text-xs">Price per person £ (0 = free)<input id={`${p}-price`} name="price" type="number" step="0.01" min={0} required defaultValue={v ? v.priceMinor / 100 : 111} className={input} /></label>
      <label className="text-xs">Cost budget £<input id={`${p}-budget`} name="budget" type="number" step="0.01" min={0} defaultValue={v ? v.budgetMinor / 100 : 0} className={input} /></label>
      <label className="text-xs">Status
        <select id={`${p}-status`} name="status" defaultValue={v?.status ?? "planning"} className={input}>
          <option value="planning">Planning (hidden)</option>
          <option value="open">Open for registration</option>
          <option value="full">Full</option>
          <option value="closed">Registration closed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm md:col-span-2"><input id={`${p}-online`} type="checkbox" name="online" defaultChecked={v?.isOnline} /> Online event (a Zoom link is created and emailed to everyone who registers)</label>
      <label className="flex items-center gap-2 text-sm md:col-span-2"><input id={`${p}-breathwork`} type="checkbox" name="breathwork" defaultChecked={v?.includesBreathwork} /> Includes breathwork (adds a health notice and a required acknowledgment)</label>
      <div className="md:col-span-2"><button className="rounded-full bg-navy-900 px-4 py-2 text-sm text-ivory">{mode === "create" ? "Create event" : "Save changes"}</button> <span role="status" className="ml-2 text-sm">{msg}</span></div>
    </form>
  );
}

export function ChecklistEditor({ id, items }: { id: string; items: { item: string; done: boolean }[] }) {
  const [list, setList] = useState(items);
  const [msg, setMsg] = useState("");
  async function save(next: { item: string; done: boolean }[]) {
    setList(next);
    const { ok } = await post({ action: "update", id, patch: { checklist: next } });
    setMsg(ok ? "Saved" : "Couldn't save");
  }
  return (
    <div className="space-y-2 text-sm">
      {list.map((c, i) => (
        <label key={c.item} className="flex items-start gap-2">
          <input id={`check-${i}`} type="checkbox" checked={c.done} onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} className="mt-1" />
          <span className={c.done ? "text-navy-800/50 line-through" : ""}>{c.item}</span>
        </label>
      ))}
      <form
        method="post"
        className="flex gap-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("item") as HTMLInputElement;
          const text = input.value.trim();
          if (text && !list.some((x) => x.item === text)) save([...list, { item: text, done: false }]);
          input.value = "";
        }}
      >
        <label htmlFor="check-new" className="sr-only">New checklist item</label>
        <input id="check-new" name="item" maxLength={200} placeholder="Add an item" className="flex-1 rounded-lg border border-navy-900/20 px-3 py-1.5" />
        <button className="rounded-full border border-navy-900/30 px-3 text-xs">Add</button>
      </form>
      {msg && <p role="status" className="text-xs text-navy-800/60">{msg}</p>}
    </div>
  );
}

export function CancelRegistrationButton({ id, paid }: { id: string; paid: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  if (!confirming) return <button onClick={() => setConfirming(true)} className="text-xs underline">Cancel</button>;
  return (
    <div className="flex flex-col items-end gap-1">
      <label htmlFor={`reason-${id}`} className="sr-only">Reason</label>
      <input id={`reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-40 rounded border border-navy-900/20 px-2 py-1 text-xs" />
      {paid && <p className="max-w-48 text-right text-xs text-earth">Paid place: request any refund separately so it goes through approval.</p>}
      <div className="flex gap-2">
        <button
          disabled={!reason.trim()}
          className="rounded-full bg-red-700 px-3 py-1 text-xs text-white disabled:opacity-50"
          onClick={async () => {
            const { ok, j } = await post({ action: "cancel_registration", registrationId: id, reason });
            if (ok) window.location.reload();
            else setMsg(j.error ?? "Failed");
          }}
        >
          Confirm cancel
        </button>
        <button onClick={() => setConfirming(false)} className="text-xs underline">Keep</button>
      </div>
      {msg && <p role="alert" className="text-xs text-red-700">{msg}</p>}
    </div>
  );
}
