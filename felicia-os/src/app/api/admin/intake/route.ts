import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, handle, requireUser } from "@/lib/server";
import { intakeRecords } from "@/lib/db/schema";
import { decryptJson } from "@/lib/security/encryption";
import { env } from "@/lib/config/env";
import { audit } from "@/lib/audit/audit";

/** Owner-only, every read audited. Decrypted data is returned to the browser, never stored elsewhere. */
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser("intake.read");
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const d = await db();
    const [rec] = await d.select().from(intakeRecords).where(eq(intakeRecords.id, id));
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await audit(d, { actor: `user:${u.id}`, action: "intake.viewed", target: id });
    return NextResponse.json({ consentVersion: rec.consentVersion, consentSignedAt: rec.consentSignedAt, ...decryptJson<Record<string, unknown>>(rec.encryptedPayload, env().DATA_ENCRYPTION_KEY!) }, { headers: { "cache-control": "no-store" } });
  });
}
