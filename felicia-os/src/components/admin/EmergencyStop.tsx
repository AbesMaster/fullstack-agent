"use client";
import { useState } from "react";

export function EmergencyStop({ engaged }: { engaged: boolean }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const reason = prompt(engaged ? "Reason for resuming automation?" : "Reason for stopping ALL automated operations?");
    if (!reason) return;
    setBusy(true);
    await fetch("/api/admin/emergency-stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engaged: !engaged, reason }) });
    window.location.reload();
  }
  return (
    <button onClick={toggle} disabled={busy} className={`rounded-full px-5 py-2.5 text-sm font-semibold ${engaged ? "bg-sage text-navy-950" : "bg-red-700 text-white"}`}>
      {engaged ? "Resume automation" : "Emergency stop"}
    </button>
  );
}
