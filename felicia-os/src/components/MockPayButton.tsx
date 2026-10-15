"use client";
import { useState } from "react";

export function MockPayButton({ reference, amountMinor }: { reference: string; amountMinor: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      className="mt-6 w-full rounded-full bg-navy-900 px-6 py-3 text-ivory disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        const r = await fetch("/api/admin/mock-payment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference, amountMinor }) });
        window.location.href = r.ok ? `/book/thank-you?booking=${reference}` : "/book?cancelled=1";
      }}
    >
      Simulate successful test payment
    </button>
  );
}
