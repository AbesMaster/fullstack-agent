import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, requireUser } from "@/lib/server";
import { updateService } from "@/lib/services/catalogue";

export async function PATCH(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const u = await requireUser("services.edit");
    const b = z.object({ id: z.string(), patch: z.record(z.unknown()) }).parse(await req.json());
    const s = await updateService(await db(), b.id, b.patch as never, `user:${u.id}`);
    return NextResponse.json({ ok: true, service: s });
  });
}
