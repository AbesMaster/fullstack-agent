import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { requestSignInLink } from "@/lib/portal/portal";

/** Always gives the same answer, so the form can't be used to find out who is a client. */
export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("portal-link", 5);
    const { email } = z.object({ email: z.string().trim().email().max(254) }).parse(await req.json());
    await requestSignInLink(await db(), email);
    return NextResponse.json({ ok: true, message: "If that email has a booking with us, a sign-in link is on its way. It expires in 15 minutes." });
  });
}
