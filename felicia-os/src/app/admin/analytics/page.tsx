import Link from "next/link";
import { db, requirePageUser } from "@/lib/server";
import { funnelReport, rangeEndingToday, websiteReport, RETENTION_DAYS } from "@/lib/analytics/analytics";
import { Card, Stat } from "@/components/admin/Stat";
import { DailyChart } from "@/components/admin/DailyChart";
import { formatMoney } from "@/lib/util";

const RANGES = [7, 30, 90] as const;

/** Plain names for the site's tracked buttons; unknown labels show as recorded. */
const BUTTON_NAMES: Record<string, string> = {
  cta_header_discovery: "Header: Book a free call",
  cta_hero_discovery: "Homepage hero: Book discovery call",
  cta_hero_explore: "Homepage hero: Explore experiences",
  cta_home_rtw: "Homepage: Discover Return to Wonder",
  cta_footer_discovery: "Homepage footer: Book discovery call",
  cta_event_details: "Events list: Details & booking",
  cta_rtw_dates: "Return to Wonder: See upcoming dates",
  cta_rtw_interest: "Return to Wonder: Register interest (hero)",
  cta_rtw_empty_interest: "Return to Wonder: Register interest (no dates yet)",
  cta_rtw_event: "Return to Wonder: Date details & booking",
  cta_rtw_discovery: "Return to Wonder: Book discovery call",
};
const buttonName = (label: string) =>
  BUTTON_NAMES[label] ??
  (label.startsWith("cta_service_book_") ? `Service card: Book (${label.slice(17).replace(/-/g, " ")})` : label.startsWith("cta_service_discovery_") ? `Service card: Start with discovery call (${label.slice(22).replace(/-/g, " ")})` : label);
const BAR = "#6a55b5";

function Funnel({ steps }: { steps: { stage: string; value: number; source: "site" | "records" }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        // Step rates only compare like with like: website→website or records→records.
        // Mixing them (anonymous visits vs named records) would produce meaningless or >100% rates.
        const prevStep = i > 0 ? steps[i - 1]! : null;
        const rate = prevStep && prevStep.value > 0 && prevStep.source === s.source ? Math.round((s.value / prevStep.value) * 1000) / 10 : null;
        return (
          <li key={s.stage}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{s.stage} <span className="text-xs text-navy-800/50">({s.source === "site" ? "website" : "your records"})</span></span>
              <span className="tabular-nums"><strong>{s.value}</strong>{rate != null && <span className="ml-2 text-xs text-navy-800/60">{rate}% of previous step</span>}</span>
            </div>
            <div className="mt-1 h-2.5 rounded-full bg-ivory" aria-hidden="true">
              {s.value > 0 && <div className="h-2.5 rounded-full" style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, background: BAR }} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <p className="text-sm text-navy-800/60">No data in this period yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-navy-800/60"><tr>{head.map((h, i) => <th key={h} className={`p-2 ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={String(r[0])} className="border-t border-navy-900/5">{r.map((c, i) => <td key={i} className={`p-2 ${i > 0 ? "text-right tabular-nums" : "break-all"}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requirePageUser("dashboard.view");
  const wanted = (await searchParams).days;
  const days = RANGES.find((d) => String(d) === wanted) ?? 30;
  const d = await db();
  const range = rangeEndingToday(days);
  const web = await websiteReport(d, range);
  const rec = await funnelReport(d, range, web);
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">Analytics</h1>
          <p className="text-sm text-navy-800/60">{new Date(`${range.from}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })} – {new Date(`${range.to}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <nav aria-label="Period" className="flex gap-2">
          {RANGES.map((r) => (
            <Link key={r} href={`/admin/analytics?days=${r}`} aria-current={r === days ? "page" : undefined} className={`rounded-full border px-4 py-1.5 text-sm ${r === days ? "border-navy-900 bg-navy-900 text-ivory" : "border-navy-900/20 bg-white"}`}>
              Last {r} days
            </Link>
          ))}
        </nav>
      </div>

      <p className="rounded-xl bg-white p-4 text-sm text-navy-800/80">
        Website figures come from FELICIA OS's own cookieless analytics: no cookies, no personal data, and visitors who ask not to be tracked aren't counted, so true traffic is a little higher. Bookings, enquiries and payments come from your records and are exact. These are <strong>actual</strong> figures, not forecasts.
      </p>

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Website visits" value={String(web.visits)} note={`${web.pageviews} page views · ${web.pagesPerVisit ?? "—"} per visit`} />
        <Stat label="Paid bookings ÷ visits" value={rec.conversionPct != null && rec.conversionPct <= 100 ? `${rec.conversionPct}%` : "—"} note={rec.conversionPct != null && rec.conversionPct > 100 ? "More paid bookings than recorded visits (some booked another way)" : "Paid bookings per 100 website visits"} />
        <Stat label="Revenue received" value={formatMoney(rec.revenueMinor)} note={`Refund rate ${pct(rec.refundRatePct)}`} />
        <Stat label="Show-up rate" value={pct(rec.showUpRatePct)} note={`Events: ${pct(rec.eventShowUpPct)}. Past sessions count as attended unless marked no-show`} />
      </section>

      <Card title="Visits per day">
        <DailyChart data={web.daily} />
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-navy-800/70">Show as a table</summary>
          <Table head={["Day", "Visits", "Page views"]} rows={web.daily.map((x) => [x.day, x.visits, x.pageviews])} />
        </details>
      </Card>

      <Card title="Website journey">
        <Funnel steps={rec.website} />
      </Card>

      <section className="grid gap-6 lg:grid-cols-2" aria-label="Acquisition funnels">
        {rec.funnels.map((f) => (
          <Card key={f.key} title={`Funnel ${f.key}: ${f.title}`}>
            <Funnel steps={f.steps} />
            <p className="mt-3 text-xs text-navy-800/60">{f.note}</p>
          </Card>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Where visits come from">
          <Table head={["Channel", "Visits"]} rows={web.channels.map((c) => [c.channel, c.visits])} />
          <h3 className="mt-5 text-lg">Top sources</h3>
          <Table head={["Source", "Visits"]} rows={web.sources.map((s) => [s.source, s.visits])} />
          {web.campaigns.length > 0 && (
            <>
              <h3 className="mt-5 text-lg">Campaigns</h3>
              <Table head={["Campaign", "Visits"]} rows={web.campaigns.map((s) => [s.campaign, s.visits])} />
            </>
          )}
        </Card>
        <Card title="Most viewed pages">
          <Table head={["Page", "Views", "Visits"]} rows={web.topPages.map((p) => [p.path, p.views, p.visits])} />
        </Card>
        <Card title="Button clicks">
          <Table head={["Button", "Clicks"]} rows={web.ctaClicks.map((c) => [buttonName(c.label), c.clicks])} />
          <p className="mt-3 text-xs text-navy-800/60">AI chat opened {web.chatOpens} time{web.chatOpens === 1 ? "" : "s"}.</p>
        </Card>
        <Card title="Devices">
          <Table head={["Device", "Visits"]} rows={web.devices.map((x) => [x.device, x.visits])} />
        </Card>
      </div>

      <Card title="Tracking your campaigns">
        <p className="text-sm text-navy-800/80">Add tags to links you share so this page can tell which posts and emails bring people in. For example, in your Instagram bio use:</p>
        <code className="mt-2 block overflow-x-auto rounded-lg bg-ivory p-3 text-xs">https://metamastermindz.com/?utm_source=instagram&amp;utm_medium=social&amp;utm_campaign=bio</code>
        <p className="mt-3 text-xs text-navy-800/60">Raw visit records are kept for {Math.round(RETENTION_DAYS / 30)} months, then deleted automatically.</p>
      </Card>
    </div>
  );
}
