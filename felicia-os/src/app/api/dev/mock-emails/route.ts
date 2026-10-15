import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { emailTransport, MockTransport } from "@/lib/email/send";

/**
 * DEVELOPMENT AND AUTOMATED TESTS ONLY: shows emails the stand-in mail service "sent"
 * to one address. Returns 404 in production or whenever a real email provider is set up.
 */
export async function GET(req: Request) {
  const t = emailTransport();
  if (env().APP_ENV === "production" || !(t instanceof MockTransport)) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const to = new URL(req.url).searchParams.get("to")?.toLowerCase() ?? "";
  return NextResponse.json(t.outbox.filter((m) => m.to === to).map(({ subject, text }) => ({ subject, text })));
}
