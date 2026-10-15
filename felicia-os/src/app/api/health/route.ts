import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/server";

export async function GET() {
  try {
    const d = await db();
    await d.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
