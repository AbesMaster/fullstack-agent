import { NextResponse } from "next/server";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { submitIntake } from "@/lib/booking/booking";
import { verifyResourceToken } from "@/lib/security/tokens";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("intake", 5);
    const body = await req.json();
    if (!body?.bookingId || !body?.token || !verifyResourceToken("intake", String(body.bookingId), String(body.token))) {
      return NextResponse.json({ error: "This link is invalid or has expired. Please reply to your booking email." }, { status: 403 });
    }
    const { token: _t, ...intake } = body;
    const r = await submitIntake(await db(), intake);
    return NextResponse.json({ ok: true, requiresReview: r.requiresReview }, { status: 201 });
  });
}
