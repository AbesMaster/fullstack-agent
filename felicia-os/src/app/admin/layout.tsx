import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, db } from "@/lib/server";
import { isEmergencyStopped } from "@/lib/agents/controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Felicia Command Center", robots: { index: false } };

const NAV = [
  ["/admin", "Overview"],
  ["/admin/approvals", "Approvals"],
  ["/admin/clients", "Enquiries & bookings"],
  ["/admin/events", "Events"],
  ["/admin/finance", "Finance"],
  ["/admin/content", "Content"],
  ["/admin/services", "Services"],
  ["/admin/knowledge", "Knowledge"],
  ["/admin/agents", "Agents"],
  ["/admin/audit", "Audit log"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const stopped = await isEmergencyStopped(await db());
  return (
    <div className="min-h-screen bg-ivory">
      <header className="bg-navy-950 text-ivory">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/admin" className="font-display text-xl text-gold-soft">Felicia Command Center</Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-ivory/70">{user.name} · {user.role}</span>
            <form action="/api/auth/logout" method="post"><button className="underline">Sign out</button></form>
          </div>
        </div>
        <nav aria-label="Command Center" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 text-sm">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="whitespace-nowrap rounded-full px-3 py-1.5 text-ivory/80 hover:bg-white/10">{label}</Link>)}
        </nav>
      </header>
      {stopped && <div role="alert" className="bg-red-700 px-4 py-2 text-center text-sm text-white">EMERGENCY STOP ENGAGED — all automated operations are paused.</div>}
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
