import { NextResponse } from "next/server";
import { db } from "@/lib/server";
import { unsubscribe } from "@/lib/email/send";

/** RFC 8058 one-click unsubscribe (POST from mail clients). */
export async function POST(req: Request) {
  const u = new URL(req.url);
  try {
    await unsubscribe(await db(), u.searchParams.get("e") ?? "", u.searchParams.get("t") ?? "");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
}
