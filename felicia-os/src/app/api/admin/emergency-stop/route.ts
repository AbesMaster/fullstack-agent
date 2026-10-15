import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, requireUser } from "@/lib/server";
import { setEmergencyStop } from "@/lib/agents/controls";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const u = await requireUser("emergency_stop.toggle");
    const b = z.object({ engaged: z.boolean(), reason: z.string().min(1).max(500) }).parse(await req.json());
    await setEmergencyStop(await db(), b.engaged, `user:${u.id}`, b.reason);
    return NextResponse.json({ ok: true });
  });
}
