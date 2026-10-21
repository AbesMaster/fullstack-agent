import { NextResponse } from "next/server";
import { db, handle, requireUser } from "@/lib/server";
import { can } from "@/lib/auth/auth";
import { commandOverview } from "@/lib/command/overview";

/** Live data for JARVIS. Money figures only for roles allowed to see finance. */
export async function GET() {
  return handle(async () => {
    const u = await requireUser("dashboard.view");
    return NextResponse.json(await commandOverview(await db(), { includeMoney: can(u.role, "finance.view") }), { headers: { "cache-control": "no-store" } });
  });
}
