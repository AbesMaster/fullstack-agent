import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, requireUser } from "@/lib/server";
import { bus, decideAndDispatch } from "@/lib/agents/workflows";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const u = await requireUser("approvals.decide");
    const b = z.object({ id: z.string(), decision: z.enum(["approved", "rejected"]), note: z.string().max(500).optional() }).parse(await req.json());
    const d = await db();
    await decideAndDispatch(d, b.id, b.decision, u, b.note);
    await bus().drain(d).catch(() => undefined);
    return NextResponse.json({ ok: true });
  });
}
