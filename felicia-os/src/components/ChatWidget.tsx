"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";

type Turn = { role: "user" | "assistant"; text: string; link?: string | null };

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.current?.value.trim();
    if (!text || busy) return;
    input.current!.value = "";
    const next = [...turns, { role: "user" as const, text }];
    setTurns(next);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, history: turns.map(({ role, text }) => ({ role, text })) }) });
      const j = await res.json();
      setTurns([...next, { role: "assistant", text: j.reply ?? j.error ?? "Sorry, something went wrong.", link: j.link }]);
    } catch {
      setTurns([...next, { role: "assistant", text: "Sorry, I couldn't connect. Please use the contact form." , link: "/contact" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (
        <section aria-label="Chat with our AI assistant" className="mb-3 flex h-[28rem] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-navy-900/10 bg-white shadow-2xl">
          <header className="bg-navy-900 px-4 py-3 text-ivory">
            <p className="font-medium">AI assistant</p>
            <p className="text-xs text-ivory/70">An AI, not Felicia. Not for medical advice or emergencies.</p>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
            {turns.length === 0 && <p className="text-navy-800/70">Ask about sessions, programmes, prices or booking.</p>}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "ml-8 rounded-xl bg-lavender/20 p-3" : "mr-8 rounded-xl bg-ivory p-3"}>
                <p>{t.text}</p>
                {t.link && <Link href={t.link} className="mt-2 inline-block text-xs font-medium text-lavender-deep underline">Go there →</Link>}
              </div>
            ))}
            {busy && <p className="text-navy-800/60">Thinking…</p>}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-navy-900/10 p-3">
            <label htmlFor="chat-input" className="sr-only">Your message</label>
            <input id="chat-input" ref={input} maxLength={1000} className="flex-1 rounded-full border border-navy-900/20 px-4 py-2 text-sm" placeholder="Type your question…" />
            <button className="rounded-full bg-gold px-4 text-sm font-medium text-navy-950" disabled={busy}>Send</button>
          </form>
        </section>
      )}
      <button type="button" onClick={() => setOpen((v) => { if (!v) track("chat_opened"); return !v; })} aria-expanded={open} className="ml-auto block rounded-full bg-navy-900 px-5 py-3 text-sm text-ivory shadow-lg hover:bg-navy-700">
        {open ? "Close chat" : "Questions? Chat with our AI assistant"}
      </button>
    </div>
  );
}
