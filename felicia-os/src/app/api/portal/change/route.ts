import { NextResponse } from "next/server";
import { assertSameOrigin, currentClientId, db, handle, rateLimit } from "@/lib/server";
import { requestChange } from "@/lib/portal/portal";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("portal-change", 10);
    const contactId = await currentClientId();
    if (!contactId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    await requestChange(await db(), contactId, await req.json());
    return NextResponse.json({ ok: true });
  });
}
