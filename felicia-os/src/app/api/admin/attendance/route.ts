import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, requireUser } from "@/lib/server";
import { markAttendance } from "@/lib/analytics/analytics";
import { audit } from "@/lib/audit/audit";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const u = await requireUser("events.manage");
    const b = z.object({ kind: z.enum(["booking", "registration"]), id: z.string(), attended: z.boolean() }).parse(await req.json());
    const d = await db();
    const status = await markAttendance(d, b.kind, b.id, b.attended);
    await audit(d, { actor: `user:${u.id}`, action: "attendance.marked", target: b.id, metadata: { kind: b.kind, status } });
    return NextResponse.json({ status });
  });
}
