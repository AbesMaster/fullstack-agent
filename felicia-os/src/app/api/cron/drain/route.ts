import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/server";
import { bus } from "@/lib/agents/workflows";

/** Called by the scheduler (e.g. every minute) to process the event outbox. Protected by CRON_SECRET. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const r = await bus().drain(await db(), { limit: 100 });
  return NextResponse.json(r);
}
