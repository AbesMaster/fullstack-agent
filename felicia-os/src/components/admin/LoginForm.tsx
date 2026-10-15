"use client";
import { useHydrated } from "@/components/useHydrated";
import { useState } from "react";

export function LoginForm() {
  const hydrated = useHydrated();
  const [err, setErr] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.get("email"), password: f.get("password"), totp: f.get("totp") || undefined }) });
    setBusy(false);
    if (r.ok) window.location.href = "/admin";
    else {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "Sign-in failed");
      if (j.needsTotp) setNeedsTotp(true);
    }
  }
  const input = "mt-1 w-full rounded-xl border border-navy-900/20 px-4 py-3";
  return (
    <form method="post" onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm">Email<input name="email" type="email" required autoComplete="username" className={input} /></label>
      <label className="block text-sm">Password<input name="password" type="password" required autoComplete="current-password" className={input} /></label>
      <label className="block text-sm">Authenticator code{!needsTotp && " (admins)"}<input name="totp" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" className={input} /></label>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <button disabled={!hydrated || busy} className="w-full rounded-full bg-navy-900 py-3 text-ivory disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
