import { NextResponse } from "next/server";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { registerForEvent } from "@/lib/programme/events";
import { bus } from "@/lib/agents/workflows";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("event-registration", 6);
    const d = await db();
    const r = await registerForEvent(d, await req.json());
    await bus().drain(d, { limit: 20 }).catch(() => undefined); // best-effort; the worker retries anything left
    return NextResponse.json(r, { status: 201 });
  });
}
