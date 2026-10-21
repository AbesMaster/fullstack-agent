import { db, requirePageUser } from "@/lib/server";
import { can } from "@/lib/auth/auth";
import { commandOverview } from "@/lib/command/overview";
import { JarvisConsole } from "@/components/admin/JarvisConsole";

export const dynamic = "force-dynamic";
export const metadata = { title: "JARVIS · Felicia Command Center" };

export default async function Page() {
  const u = await requirePageUser("dashboard.view");
  const data = await commandOverview(await db(), { includeMoney: can(u.role, "finance.view") });
  return (
    <div className="space-y-3">
      <JarvisConsole initial={data} />
      <p className="text-xs text-navy-800/60">
        Every number is live from your business records and the agents&apos; task log, refreshed every 20 seconds. The light streams grow brighter when a department is busier. Click a card to spotlight it.
      </p>
    </div>
  );
}
