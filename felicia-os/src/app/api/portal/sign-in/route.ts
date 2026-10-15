import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { CLIENT_COOKIE, SESSION_DAYS, consumeSignInLink, createClientSession } from "@/lib/portal/portal";
import { env } from "@/lib/config/env";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("portal-sign-in", 10);
    const { token } = z.object({ token: z.string().max(200) }).parse(await req.json());
    const contactId = await consumeSignInLink(await db(), token);
    if (!contactId) return NextResponse.json({ error: "This link has expired or has already been used. Request a new one below." }, { status: 400 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CLIENT_COOKIE, await createClientSession(contactId), { httpOnly: true, secure: env().APP_ENV !== "development", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
    return res;
  });
}
