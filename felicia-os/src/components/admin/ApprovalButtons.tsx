"use client";
import { useState } from "react";

export function ApprovalButtons({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approved" | "rejected") {
    const note = decision === "rejected" ? prompt("Reason (optional)") ?? undefined : undefined;
    setBusy(true);
    const r = await fetch(`/api/admin/approvals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, decision, note }) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? "Failed");
    window.location.reload();
  }
  return (
    <div className="flex gap-2">
      <button disabled={busy} onClick={() => decide("approved")} className="rounded-full bg-navy-900 px-4 py-2 text-sm text-ivory">Approve</button>
      <button disabled={busy} onClick={() => decide("rejected")} className="rounded-full border border-navy-900/30 px-4 py-2 text-sm">Reject</button>
    </div>
  );
}
