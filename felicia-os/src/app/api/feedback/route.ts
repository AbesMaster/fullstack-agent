import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { feedback } from "@/lib/db/schema";
import { verifyResourceToken } from "@/lib/security/tokens";
import { newId } from "@/lib/util";

const Body = z.object({
  bookingId: z.string(),
  token: z.string(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(3000).optional(),
  consentToPublish: z.boolean().default(false),
  publishName: z.string().trim().max(80).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("feedback", 5);
    const b = Body.parse(await req.json());
    if (!verifyResourceToken("feedback", b.bookingId, b.token)) return NextResponse.json({ error: "Invalid link" }, { status: 403 });
    await (await db()).insert(feedback).values({ id: newId("fbk"), bookingId: b.bookingId, rating: b.rating, comment: b.comment, consentToPublish: b.consentToPublish, publishName: b.consentToPublish ? b.publishName : null }).onConflictDoNothing();
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
