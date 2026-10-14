export function Stat({ label, value, note, tone = "actual" }: { label: string; value: string; note?: string; tone?: "actual" | "forecast" | "target" }) {
  const badge = { actual: "bg-sage/30 text-navy-900", forecast: "bg-lavender/30 text-navy-900", target: "bg-gold/30 text-navy-900" }[tone];
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-navy-800/60">{label}</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge}`}>{tone}</span>
      </div>
      <p className="mt-2 font-display text-3xl text-navy-900">{value}</p>
      {note && <p className="mt-1 text-xs text-navy-800/60">{note}</p>}
    </div>
  );
}

export function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xl text-navy-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
