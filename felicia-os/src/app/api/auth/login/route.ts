import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { login, SESSION_COOKIE } from "@/lib/auth/auth";
import { env } from "@/lib/config/env";

const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional() });

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("login", 10);
    const b = Body.parse(await req.json());
    const r = await login(await db(), b.email, b.password, b.totp);
    if (!r.ok) return NextResponse.json({ error: r.error, needsTotp: "needsTotp" in r ? r.needsTotp : false }, { status: 401 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, r.token, { httpOnly: true, secure: env().APP_ENV !== "development", sameSite: "strict", path: "/", maxAge: 12 * 3600 });
    return res;
  });
}
