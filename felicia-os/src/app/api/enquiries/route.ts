import { NextResponse } from "next/server";
import { bus } from "@/lib/agents/workflows";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { createEnquiry } from "@/lib/booking/booking";
import { randomUUID } from "node:crypto";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("enquiry", 5);
    const body = await req.json();
    const key = req.headers.get("idempotency-key")?.slice(0, 100) || randomUUID();
    const r = await createEnquiry(await db(), body, `web:${key}`);
    await bus().drain(await db(), { limit: 20 }).catch(() => undefined); // best-effort; the worker retries anything left
    return NextResponse.json({ ok: true, enquiryId: r.enquiryId }, { status: 201 });
  });
}
