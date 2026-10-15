import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, currentClientId, db, handle } from "@/lib/server";
import { setMarketingPreference } from "@/lib/portal/portal";

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const contactId = await currentClientId();
    if (!contactId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const { marketing } = z.object({ marketing: z.boolean() }).parse(await req.json());
    await setMarketingPreference(await db(), contactId, marketing);
    return NextResponse.json({ ok: true });
  });
}
