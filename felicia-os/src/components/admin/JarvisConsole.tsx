"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandOverview } from "@/lib/command/overview";

/**
 * JARVIS: live mission control for Felicia OS. Six department streams flow into the
 * Commander core. Numbers are real (from /api/admin/command, refreshed every 20 s); the
 * particles are decoration whose intensity follows each department's real activity.
 */

const ARC = [0, 0.055, 0.085, 0.085, 0.055, 0]; // tiles sit on a gentle arc, like a gate
const ROTATE_MS = 3200;
const REFRESH_MS = 20_000;

const ACTIONS: Record<string, string> = {
  Executive: "reviewing approvals",
  Acquisition: "following up enquiries",
  Operations: "keeping the diary in order",
  Experiences: "caring for clients & events",
  Finance: "reconciling payments",
  Expansion: "scanning new markets",
};

export function JarvisConsole({ initial }: { initial: CommandOverview }) {
  const [data, setData] = useState(initial);
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [typed, setTyped] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  activeRef.current = active;

  // Motion preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Live data
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/admin/command", { cache: "no-store" });
        if (r.ok) setData(await r.json());
      } catch {
        /* keep showing the last good data */
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Clock and the stream spotlight
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    if (reduced) return () => clearInterval(t);
    const r = setInterval(() => setActive((a) => (a + 1) % 6), ROTATE_MS);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [reduced]);

  // Terminal line: the latest real activity of the spotlighted department, typed out
  const line = useMemo(() => {
    const s = data.streams[active]!;
    const hit = data.feed.find((f) => f.department === s.department);
    const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
    return hit ? `${time(hit.at)} [${s.label.toLowerCase()}] ${hit.agent}: ${hit.kind} ${hit.status === "succeeded" ? "✓" : hit.status}` : `${time(data.generatedAt)} [${s.label.toLowerCase()}] ${ACTIONS[s.label]} · no tasks in the last 24 hours`;
  }, [active, data]);
  useEffect(() => {
    if (reduced) return setTyped(line);
    setTyped("");
    let i = 0;
    const t = setInterval(() => {
      i += 2;
      setTyped(line.slice(0, i));
      if (i >= line.length) clearInterval(t);
    }, 22);
    return () => clearInterval(t);
  }, [line, reduced]);

  // The scene
  useEffect(() => {
    const canvas = canvasRef.current!;
    const box = boxRef.current!;
    const ctx = canvas.getContext("2d")!;
    let w = 0, h = 0, raf = 0, last = performance.now();
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = box.clientWidth;
      h = box.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);

    const geo = () => {
      const narrow = w < 640;
      const core = { x: w * (narrow ? 0.72 : 0.7), y: h * 0.5, r: Math.min(w * (narrow ? 0.21 : 0.2), h * 0.33) };
      const src = ARC.map((a, i) => ({ x: w * (0.13 + a), y: h * (0.1 + i * 0.16) })); // matches the tile positions
      return { core, src };
    };

    type P = { s: number; t: number; v: number; off: number; size: number };
    const parts: P[] = [];
    const swirl = Array.from({ length: 420 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()), v: 0.0015 + Math.random() * 0.004, z: Math.random() }));
    const hex = (c: string, a: number) => {
      const n = parseInt(c.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const { core, src } = geo();
      const streams = dataRef.current.streams;
      const act = activeRef.current;
      const time = now / 1000;

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = reduced ? "rgb(6,8,20)" : "rgba(6,8,20,0.32)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // The gate: a tall faint arc between the agents and the core
      const gx = w * 0.42;
      ctx.strokeStyle = "rgba(120,130,210,0.07)";
      ctx.lineWidth = 34;
      ctx.beginPath();
      ctx.arc(gx + h * 1.1, h / 2, h * 1.15, Math.PI * 0.86, Math.PI * 1.14);
      ctx.stroke();
      ctx.strokeStyle = "rgba(200,205,255,0.14)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Fibre threads: the resting shape of each stream, brighter for the spotlighted one
      streams.forEach((s, i) => {
        const a = src[i]!;
        const ex = core.x - core.r * 0.95, ey = core.y + (a.y - core.y) * 0.12;
        for (let k = 0; k < 16; k++) {
          const off = (k / 15 - 0.5) * 2;
          const wob = Math.sin(time * 0.8 + k * 1.7 + i) * 6;
          ctx.strokeStyle = hex(s.color, i === act ? 0.09 : 0.035);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x + 30, a.y + off * 6);
          ctx.quadraticCurveTo((a.x + ex) / 2 + 40, (a.y + ey) / 2 + off * 60 + wob, ex, ey + off * 10);
          ctx.stroke();
        }
      });

      // Spawn particles: busier departments and the spotlighted one stream harder
      if (!reduced) {
        streams.forEach((s, i) => {
          const busy = Math.min(1, s.tasks24 / 20);
          const rate = (0.9 + busy * 1.6 + (i === act ? 3.2 : 0)) * (dt / 16);
          for (let k = 0; k < rate; k++) if (Math.random() < rate - k) parts.push({ s: i, t: 0, v: 0.004 + Math.random() * 0.006, off: (Math.random() - 0.5) * 2, size: Math.random() * 2 + 0.6 });
        });
      }

      // Streams
      for (let p = parts.length - 1; p >= 0; p--) {
        const q = parts[p]!;
        q.t += q.v * (dt / 16) * (q.s === act ? 1.4 : 1);
        if (q.t >= 1) {
          parts.splice(p, 1);
          continue;
        }
        const a = src[q.s]!;
        const ex = core.x - core.r * 0.95, ey = core.y + (a.y - core.y) * 0.12;
        const cx = (a.x + ex) / 2 + 40, cy = (a.y + ey) / 2 + q.off * 60;
        const t = q.t, u = 1 - t;
        const x = u * u * (a.x + 34) + 2 * u * t * cx + t * t * ex + Math.sin(time * 3 + q.off * 9) * 4 * u;
        const y = u * u * a.y + 2 * u * t * cy + t * t * ey + q.off * 14 * u * t;
        const col = streams[q.s]!.color;
        ctx.fillStyle = hex(col, (q.s === act ? 1 : 0.6) * Math.sin(Math.PI * t));
        ctx.fillRect(x, y, q.size, q.size);
      }
      if (parts.length > 4000) parts.splice(0, parts.length - 4000);

      // Rays around the core, coloured by department
      const rays = 220;
      for (let i = 0; i < rays; i++) {
        const ang = (i / rays) * Math.PI * 2;
        const len = core.r * (0.18 + 0.5 * Math.abs(Math.sin(i * 12.9898 + time * 0.6) * Math.sin(i * 0.37 + time * 0.25)));
        const col = streams[i % 6]!.color;
        ctx.strokeStyle = hex(col, i % 6 === act ? 0.5 : 0.18);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(core.x + Math.cos(ang) * core.r * 1.12, core.y + Math.sin(ang) * core.r * 1.12);
        ctx.lineTo(core.x + Math.cos(ang) * (core.r * 1.12 + len), core.y + Math.sin(ang) * (core.r * 1.12 + len));
        ctx.stroke();
      }

      // Rings
      const ringCol = streams[act]!.color;
      ctx.lineWidth = 3;
      ctx.strokeStyle = hex(ringCol, 0.55);
      ctx.beginPath();
      ctx.arc(core.x, core.y, core.r * 1.04, time * 0.4, time * 0.4 + Math.PI * 1.3);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(220,215,255,0.35)";
      ctx.beginPath();
      ctx.arc(core.x, core.y, core.r * 1.08, -time * 0.25, -time * 0.25 + Math.PI * 1.7);
      ctx.stroke();
      // tick marks
      ctx.strokeStyle = "rgba(220,215,255,0.25)";
      for (let i = 0; i < 90; i++) {
        const ang = (i / 90) * Math.PI * 2 + time * 0.05;
        const r1 = core.r * 1.13, r2 = r1 + (i % 5 === 0 ? 7 : 3);
        ctx.beginPath();
        ctx.moveTo(core.x + Math.cos(ang) * r1, core.y + Math.sin(ang) * r1);
        ctx.lineTo(core.x + Math.cos(ang) * r2, core.y + Math.sin(ang) * r2);
        ctx.stroke();
      }

      // Swirling core
      const glow = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, core.r);
      glow.addColorStop(0, "rgba(255,250,255,0.55)");
      glow.addColorStop(0.35, "rgba(170,140,255,0.22)");
      glow.addColorStop(1, "rgba(40,30,90,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(core.x, core.y, core.r, 0, Math.PI * 2);
      ctx.fill();
      for (const s of swirl) {
        if (!reduced) s.a += s.v * (dt / 16) * (1.4 - s.r);
        const rr = s.r * core.r * 0.92;
        const x = core.x + Math.cos(s.a) * rr, y = core.y + Math.sin(s.a) * rr * (0.85 + s.z * 0.15);
        const c = streams[Math.floor(s.z * 6)]!.color;
        ctx.fillStyle = hex(c, 0.25 + (1 - s.r) * 0.6);
        ctx.fillRect(x, y, 1.6, 1.6);
      }

      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced]);

  const top = data.top;
  const ukTime = clock.toLocaleTimeString("en-GB", { timeZone: "Europe/London" });
  const stats: [string, string, string][] = [
    ["UK time", ukTime, "text-ivory"],
    ["Enquiries today", String(top.enquiriesToday), "text-[#3fcf9f]"],
    ["Bookings · month", String(top.bookingsMonth), "text-ivory"],
    ["Paid · month", String(top.paidMonth), "text-ivory"],
    ...(top.revenueMonthMinor === null ? [] : ([["Revenue · month", `£${(top.revenueMonthMinor / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, "text-[#e46fb3]"]] as [string, string, string][])),
    ["Awaiting you", String(top.approvalsWaiting), top.approvalsWaiting ? "text-gold" : "text-ivory"],
    ["State", data.state, data.state === "paused" ? "text-red-300" : "text-[#6f8fe8]"],
  ];

  return (
    <div className="overflow-hidden rounded-3xl bg-[#060814] font-mono text-ivory shadow-2xl ring-1 ring-white/10">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-white/10 px-5 py-3">
        <h1 className="bg-gradient-to-r from-[#e46fb3] via-[#b9aed6] to-[#6f8fe8] bg-clip-text text-xl font-bold tracking-[0.2em] text-transparent" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>JARVIS</h1>
        {stats.map(([k, v, c]) => (
          <div key={k}>
            <p className="text-[10px] uppercase tracking-widest text-ivory/45">{k}</p>
            <p className={`text-sm ${c}`}>{v}</p>
          </div>
        ))}
        <p className="ml-auto flex items-center gap-2 text-xs tracking-widest">
          <span className={`h-2 w-2 rounded-full ${data.state === "paused" ? "bg-red-400" : "bg-[#e46fb3]"} ${reduced ? "" : "animate-pulse"}`} />
          {data.state === "paused" ? "PAUSED" : "LIVE"}
        </p>
      </div>

      {/* Scene */}
      <div ref={boxRef} className="relative h-[520px] md:h-[600px]">
        <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
        <p className="sr-only">
          Six departments feed the Commander. {data.streams.map((s) => `${s.label}: ${s.metric.value} ${s.metric.label}`).join(". ")}.
        </p>
        {data.streams.map((s, i) => (
          <div
            key={s.department}
            className="absolute flex -translate-y-1/2 items-center gap-3"
            style={{ left: `calc(${(13 + ARC[i]! * 100).toFixed(1)}% - 32px)`, top: `${10 + i * 16}%` }}
          >
            <div className="hidden text-right sm:block" style={{ position: "absolute", right: "calc(100% + 10px)", whiteSpace: "nowrap" }}>
              <p className="rounded bg-black/60 px-2 font-sans text-sm font-semibold">{s.label}</p>
              <p className="px-2 text-[10px]" style={{ color: s.color }}>{s.role}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl transition md:h-16 md:w-16"
              style={{
                background: `linear-gradient(145deg, ${s.color}55, #0b0e22 70%)`,
                boxShadow: `0 0 ${i === active ? 34 : 12}px ${s.color}${i === active ? "cc" : "55"}, inset 0 0 0 1.5px ${s.color}${i === active ? "ff" : "88"}`,
                transform: i === active ? "scale(1.08)" : "none",
              }}
              title={`${s.label}: ${s.agents.join(", ")}`}
            >
              <StreamIcon index={i} color={s.color} />
            </div>
          </div>
        ))}
        <div className="pointer-events-none absolute bottom-4 right-4 text-right text-[10px] uppercase tracking-widest text-ivory/40">
          Commander · {top.agents} agents · {top.tasks24} tasks in 24 h
        </div>
      </div>

      {/* Terminal */}
      <div className="border-t border-white/10 bg-[#0a0d1c] p-4">
        <div className="flex items-center gap-2 text-xs text-ivory/50">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 truncate">felicia@commander ~ % jarvis watch --departments 6 --agents {top.agents}</span>
          <span className="ml-auto text-[#e46fb3]">● REC</span>
        </div>
        <p className="mt-3 truncate rounded-lg bg-black/40 px-3 py-2 text-sm" aria-live="polite">
          <span className="text-ivory/40">› </span>
          {typed}
          <span className={`ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-[#e46fb3] ${reduced ? "" : "animate-pulse"}`} />
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {data.streams.map((s, i) => (
            <button
              key={s.department}
              type="button"
              onClick={() => setActive(i)}
              className="rounded-xl p-3 text-left transition"
              style={{ background: i === active ? `${s.color}1f` : "rgba(255,255,255,0.03)", boxShadow: `inset 0 0 0 1px ${i === active ? s.color : "rgba(255,255,255,0.08)"}` }}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: s.color }}>% {s.label.toLowerCase()}</span>
                <span className="text-ivory/40">{s.tasks24}/24h</span>
              </div>
              <Activity hourly={s.hourly} color={s.color} />
              <p className="mt-2 font-sans text-3xl font-semibold" style={{ color: i === active ? s.color : undefined }}>{s.metric.value}</p>
              <p className="text-[11px] text-ivory/60">{s.metric.label}</p>
              <p className="text-[10px] text-ivory/35">
                {s.agents.length} agent{s.agents.length === 1 ? "" : "s"}
                {s.needsAttention ? ` · ${s.needsAttention} need attention` : ""}
              </p>
              <div className="mt-2 h-0.5 rounded bg-white/10">
                <div className="h-0.5 rounded" style={{ width: `${s.tasks24 ? Math.max(8, (s.succeeded24 / s.tasks24) * 100) : 4}%`, background: s.color }} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 24 hourly columns of dots: brighter and taller when that department's agents were busier. */
function Activity({ hourly, color }: { hourly: number[]; color: string }) {
  const max = Math.max(1, ...hourly);
  return (
    <svg viewBox="0 0 96 30" className="mt-2 h-10 w-full" aria-hidden="true">
      {hourly.map((n, x) =>
        Array.from({ length: 5 }, (_, y) => {
          const on = n > 0 && y < Math.ceil((n / max) * 5);
          return <circle key={`${x}-${y}`} cx={2 + x * 4} cy={27 - y * 6} r={on ? 1.3 : 0.7} fill={on ? color : "rgba(255,255,255,0.12)"} />;
        }),
      )}
    </svg>
  );
}

function StreamIcon({ index, color }: { index: number; color: string }) {
  const p = { fill: "none", stroke: "#f8f4ec", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const icons = [
    // Executive: crown
    <path key="0" {...p} d="M4 17h16M5 17l-1-9 5 4 3-6 3 6 5-4-1 9" />,
    // Acquisition: signal / megaphone
    <g key="1" {...p}><path d="M4 10v4h3l7 4V6l-7 4H4z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 7a7 7 0 0 1 0 10" /></g>,
    // Operations: calendar
    <g key="2" {...p}><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M9 3.5v4M15 3.5v4M8 14h2M12 14h2" /></g>,
    // Experiences: lotus
    <g key="3" {...p}><path d="M12 19c-4 0-7-2.5-8-6 3 0 5 1 8 4 3-3 5-4 8-4-1 3.5-4 6-8 6z" /><path d="M12 17c-2-2-2.5-6 0-10 2.5 4 2 8 0 10z" /></g>,
    // Finance: rising line
    <g key="4" {...p}><path d="M4 19h16" /><path d="M5 15l4-4 3 3 6-7" /><path d="M15 7h3v3" /></g>,
    // Expansion: globe
    <g key="5" {...p}><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.5 2.5 3.5 5 3.5 8s-1 5.5-3.5 8c-2.5-2.5-3.5-5-3.5-8s1-5.5 3.5-8z" /></g>,
  ];
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 md:h-8 md:w-8" style={{ filter: `drop-shadow(0 0 4px ${color})` }} aria-hidden="true">
      {icons[index]}
    </svg>
  );
}
