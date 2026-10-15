"use client";
import { useState } from "react";

/**
 * Daily visits column chart. One series, one hue (validated #6a55b5 on white),
 * recessive grid, 4px rounded tops anchored to the baseline, hover tooltip per day.
 */
const BAR = "#6a55b5";

export function DailyChart({ data }: { data: { day: string; visits: number; pageviews: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 200, padL = 36, padR = 8, padT = 12, padB = 24;
  const max = Math.max(1, ...data.map((d) => d.visits));
  const step = max <= 5 ? 1 : max <= 20 ? 5 : max <= 100 ? 20 : Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / data.length;
  const barW = Math.max(2, Math.min(28, slot - 2));
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const labelEvery = Math.ceil(data.length / 8);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Daily website visits, ${fmt(data[0]!.day)} to ${fmt(data.at(-1)!.day)}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#151b38" strokeOpacity={t === 0 ? 0.35 : 0.08} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#4a4f68" style={{ fontVariantNumeric: "tabular-nums" }}>{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const bh = y(0) - y(d.visits);
          const r = Math.min(4, barW / 2, bh);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${fmt(d.day)}: ${d.visits} visits, ${d.pageviews} page views`}>
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
              {d.visits > 0 && <path d={`M${x},${y(0)} V${y(d.visits) + r} Q${x},${y(d.visits)} ${x + r},${y(d.visits)} H${x + barW - r} Q${x + barW},${y(d.visits)} ${x + barW},${y(d.visits) + r} V${y(0)} Z`} fill={BAR} opacity={hover == null || hover === i ? 1 : 0.45} />}
              {i % labelEvery === 0 && <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#4a4f68">{fmt(d.day)}</text>}
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-lg border border-navy-900/10 bg-white px-3 py-2 text-xs shadow-md" style={{ left: `min(calc(${((padL + hover! * slot + slot / 2) / W) * 100}% + 8px), calc(100% - 9rem))` }}>
          <p className="font-medium text-navy-900">{new Date(`${h.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</p>
          <p className="tabular-nums text-navy-800">{h.visits} visit{h.visits === 1 ? "" : "s"}</p>
          <p className="tabular-nums text-navy-800/70">{h.pageviews} page view{h.pageviews === 1 ? "" : "s"}</p>
        </div>
      )}
    </div>
  );
}
