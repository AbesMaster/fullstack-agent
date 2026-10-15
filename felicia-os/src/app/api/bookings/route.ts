import { NextResponse } from "next/server";
import { bus } from "@/lib/agents/workflows";
import { randomUUID } from "node:crypto";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { requestBooking } from "@/lib/booking/booking";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("booking", 6);
    const key = req.headers.get("idempotency-key")?.slice(0, 100) || randomUUID();
    const r = await requestBooking(await db(), await req.json(), `web:${key}`);
    await bus().drain(await db(), { limit: 20 }).catch(() => undefined); // best-effort; the worker retries anything left
    return NextResponse.json(r, { status: r.duplicate ? 200 : 201 });
  });
}
