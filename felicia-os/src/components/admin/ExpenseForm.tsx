"use client";
import { useState } from "react";

export function ExpenseForm() {
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await fetch("/api/admin/finance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expense: { category: f.get("category"), description: f.get("description"), amountMinor: Math.round(Number(f.get("amount")) * 100), incurredOn: f.get("date") } }) });
    setMsg(r.ok ? "Recorded" : "Please check the values");
    if (r.ok) e.currentTarget.reset();
  }
  const input = "mt-1 w-full rounded-lg border border-navy-900/20 px-3 py-2 text-sm";
  return (
    <form method="post" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <label className="text-xs">Category<select name="category" className={input}>{["marketing", "software", "venue", "travel", "insurance", "professional_fees", "other"].map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="text-xs">Amount £<input name="amount" type="number" step="0.01" min="0.01" required className={input} /></label>
      <label className="text-xs">Date<input name="date" type="date" required className={input} /></label>
      <label className="text-xs">Description<input name="description" required maxLength={200} className={input} /></label>
      <div className="md:col-span-2"><button className="rounded-full bg-navy-900 px-4 py-2 text-sm text-ivory">Add expense</button> {msg && <span className="ml-2 text-sm">{msg}</span>}</div>
    </form>
  );
}
