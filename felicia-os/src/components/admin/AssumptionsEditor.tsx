"use client";
import { useState } from "react";

type A = Record<string, Record<string, number>>;
const FIELDS: [string, string, "pence" | "plain"][] = [
  ["discoveryCallsPerMonth", "Discovery calls / month", "plain"],
  ["monthlyGrowthPct", "Monthly growth %", "plain"],
  ["conversionRatePct", "Conversion %", "plain"],
  ["averageTransactionMinor", "Avg transaction £", "pence"],
  ["repeatRatePct", "Repeat rate %", "plain"],
  ["monthlyFixedCostsMinor", "Fixed costs £/month", "pence"],
  ["marketingSpendMinor", "Marketing £/month", "pence"],
  ["paymentFeePct", "Payment fees %", "plain"],
];

export function AssumptionsEditor({ initial }: { initial: A }) {
  const [msg, setMsg] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const out: A = {};
    for (const s of Object.keys(initial)) {
      out[s] = {};
      for (const [k, , kind] of FIELDS) out[s]![k] = kind === "pence" ? Math.round(Number(f.get(`${s}.${k}`)) * 100) : Number(f.get(`${s}.${k}`));
    }
    const r = await fetch("/api/admin/finance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assumptions: out }) });
    setMsg(r.ok ? "Saved — refresh to recalculate" : "Invalid values");
  }
  return (
    <form method="post" onSubmit={save} className="mt-6">
      <details>
        <summary className="cursor-pointer text-sm font-medium">Edit assumptions</summary>
        <div className="mt-4 overflow-x-auto">
          <table className="text-sm">
            <thead><tr><th />{Object.keys(initial).map((s) => <th key={s} className="p-2 capitalize">{s}</th>)}</tr></thead>
            <tbody>
              {FIELDS.map(([k, label, kind]) => (
                <tr key={k}>
                  <td className="p-2">{label}</td>
                  {Object.keys(initial).map((s) => (
                    <td key={s} className="p-1"><input aria-label={`${s} ${label}`} name={`${s}.${k}`} type="number" step="any" defaultValue={kind === "pence" ? initial[s]![k]! / 100 : initial[s]![k]} className="w-28 rounded border border-navy-900/20 px-2 py-1" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="mt-3 rounded-full bg-navy-900 px-4 py-2 text-sm text-ivory">Save assumptions</button>
        {msg && <span className="ml-3 text-sm">{msg}</span>}
      </details>
    </form>
  );
}
