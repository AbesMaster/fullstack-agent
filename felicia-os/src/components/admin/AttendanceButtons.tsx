"use client";
import { useState } from "react";

export function AttendanceButtons({ kind, id, status }: { kind: "booking" | "registration"; id: string; status: string }) {
  const [current, setCurrent] = useState(status);
  const [err, setErr] = useState("");
  async function mark(attended: boolean) {
    const r = await fetch("/api/admin/attendance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id, attended }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setCurrent(j.status);
    else setErr(j.error ?? "Failed");
  }
  const came = current === "completed" || current === "attended";
  const missed = current === "no_show";
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <button type="button" aria-pressed={came} onClick={() => mark(true)} className={`rounded-full border px-2 py-0.5 ${came ? "border-navy-900 bg-navy-900 text-ivory" : "border-navy-900/30"}`}>Came</button>
      <button type="button" aria-pressed={missed} onClick={() => mark(false)} className={`rounded-full border px-2 py-0.5 ${missed ? "border-red-700 bg-red-700 text-white" : "border-navy-900/30"}`}>No-show</button>
      {err && <span role="alert" className="text-red-700">{err}</span>}
    </span>
  );
}
