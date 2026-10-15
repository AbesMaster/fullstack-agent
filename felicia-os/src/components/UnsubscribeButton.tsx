"use client";
import { useState } from "react";

export function UnsubscribeButton({ email, token }: { email: string; token: string }) {
  const [done, setDone] = useState<null | boolean>(null);
  if (done) return <p role="status">You've been unsubscribed from marketing emails. You'll still receive messages about any bookings you make.</p>;
  return (
    <>
      <p>Unsubscribe <strong>{email}</strong> from marketing emails?</p>
      <button
        className="mt-6 rounded-full bg-navy-900 px-6 py-3 text-ivory"
        onClick={async () => {
          const r = await fetch(`/api/unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`, { method: "POST" });
          setDone(r.ok);
        }}
      >
        Unsubscribe
      </button>
      {done === false && <p role="alert" className="mt-3 text-sm text-red-700">That link isn't valid. Please contact us and we'll remove you manually.</p>}
    </>
  );
}
