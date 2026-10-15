"use client";
import { useState } from "react";
import Link from "next/link";
import { useHydrated } from "@/components/useHydrated";

export function PortalSignInForm() {
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const r = await fetch("/api/portal/request-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: new FormData(e.currentTarget).get("email") }) });
    const j = await r.json().catch(() => ({}));
    setState(r.ok ? "sent" : "error");
    setMsg(r.ok ? j.message : (j.error ?? "Please check your email address."));
  }
  if (state === "sent") return <p role="status" className="mt-6 rounded-xl bg-sage/25 p-4">{msg}</p>;
  return (
    <form method="post" onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm">Email<input id="portal-email" type="email" name="email" required autoComplete="email" maxLength={254} className="mt-1 w-full rounded-xl border border-navy-900/20 bg-ivory/50 px-4 py-3" /></label>
      {state === "error" && <p role="alert" className="text-sm text-red-700">{msg}</p>}
      <button disabled={!hydrated || state === "sending"} className="w-full rounded-full bg-navy-900 px-6 py-3 text-ivory disabled:opacity-50">{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
    </form>
  );
}

export function PortalConfirmSignIn({ token }: { token: string }) {
  const hydrated = useHydrated();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <p>Press the button to finish signing in on this device.</p>
      <button
        disabled={!hydrated || busy}
        className="w-full rounded-full bg-navy-900 px-6 py-3 text-ivory disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/portal/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
          if (r.ok) window.location.href = "/portal";
          else {
            setErr((await r.json().catch(() => ({}))).error ?? "Sign-in failed");
            setBusy(false);
          }
        }}
      >
        Sign in
      </button>
      {err && (
        <p role="alert" className="text-sm text-red-700">
          {err} <Link href="/portal" className="underline">Get a new link</Link>
        </p>
      )}
    </div>
  );
}
