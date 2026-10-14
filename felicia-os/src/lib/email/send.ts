import { createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { contacts, emailLog, emailSuppressions } from "../db/schema";
import { env } from "../config/env";
import { newId, normaliseEmail } from "../util";
import { renderTemplate, type TemplateId } from "./templates";

export interface EmailTransport {
  readonly name: "resend" | "mock";
  send(m: { to: string; subject: string; text: string; headers?: Record<string, string> }): Promise<{ messageId: string }>;
}

/** Resend (https://resend.com) as the suggested transactional provider; swap freely. */
export class ResendTransport implements EmailTransport {
  readonly name = "resend" as const;
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = fetch) {}
  async send(m: { to: string; subject: string; text: string; headers?: Record<string, string> }) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, headers: m.headers }),
    });
    if (!res.ok) throw new Error(`Email send failed: ${res.status}`);
    const j = (await res.json()) as { id: string };
    return { messageId: j.id };
  }
}

export class MockTransport implements EmailTransport {
  readonly name = "mock" as const;
  outbox: { to: string; subject: string; text: string; headers?: Record<string, string> }[] = [];
  async send(m: { to: string; subject: string; text: string; headers?: Record<string, string> }) {
    this.outbox.push(m);
    return { messageId: `mock_msg_${this.outbox.length}` };
  }
}

let override: EmailTransport | undefined;
let devSingleton: MockTransport | undefined;
export function setEmailTransportForTests(t: EmailTransport | undefined) {
  override = t;
}
export function emailTransport(): EmailTransport {
  if (override) return override;
  const e = env();
  if (e.EMAIL_PROVIDER_API_KEY) return new ResendTransport(e.EMAIL_PROVIDER_API_KEY, e.EMAIL_FROM);
  return (devSingleton ??= new MockTransport());
}

/* ---------------- Unsubscribe tokens ---------------- */

function unsubSecret() {
  return env().SESSION_SECRET ?? "dev-only-unsubscribe-secret-change-me-please";
}
export function unsubscribeToken(email: string) {
  return createHmac("sha256", unsubSecret()).update(`unsub:${normaliseEmail(email)}`).digest("base64url");
}
export function unsubscribeUrl(email: string) {
  return `${env().APP_URL}/unsubscribe?e=${encodeURIComponent(normaliseEmail(email))}&t=${unsubscribeToken(email)}`;
}
export async function unsubscribe(db: DB, email: string, token: string) {
  if (token !== unsubscribeToken(email)) throw new Error("Invalid unsubscribe link");
  const e = normaliseEmail(email);
  await db.insert(emailSuppressions).values({ email: e, reason: "unsubscribed" }).onConflictDoNothing();
  await db.update(contacts).set({ marketingConsent: false, updatedAt: new Date() }).where(eq(contacts.email, e));
}

/* ---------------- Sending with consent enforcement ---------------- */

export type SendResult = "sent" | "mock_sent" | "suppressed" | "blocked_no_consent" | "failed";

/**
 * Single entry point for all email. Marketing mail is blocked unless the contact has
 * recorded consent and is not suppressed; it always carries List-Unsubscribe.
 * NOTE: bulk marketing sends additionally require an approved "email.send_marketing" approval
 * (enforced by the email-marketing agent, see agents/workflows.ts).
 */
export async function sendTemplate(db: DB, template: TemplateId, to: string, vars: Record<string, string>, correlationId?: string): Promise<SendResult> {
  const rendered = renderTemplate(template, vars);
  return deliver(db, template, rendered.kind, to, rendered.subject, rendered.text, correlationId);
}

/** Approved newsletter/marketing content (from the content pipeline) to one recipient. */
export async function sendMarketingContent(db: DB, contentId: string, to: string, subject: string, text: string, correlationId?: string) {
  // Idempotent per recipient: a retried newsletter run never emails the same person twice.
  const prior = await db
    .select()
    .from(emailLog)
    .where(and(eq(emailLog.template, `content:${contentId}`), eq(emailLog.to, normaliseEmail(to)), inArray(emailLog.status, ["sent", "mock_sent"])));
  if (prior[0]) return prior[0].status as SendResult;
  return deliver(db, `content:${contentId}`, "marketing", to, subject, text, correlationId);
}

async function deliver(db: DB, template: string, kind: "transactional" | "marketing", to: string, subject: string, body: string, correlationId?: string): Promise<SendResult> {
  const address = normaliseEmail(to);
  const [suppressed] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, address));
  const log = (status: SendResult) => db.insert(emailLog).values({ id: newId("eml"), template, to: address, kind, status, correlationId });

  if (kind === "marketing") {
    if (suppressed) {
      await log("suppressed");
      return "suppressed";
    }
    const [c] = await db.select().from(contacts).where(eq(contacts.email, address));
    if (!c?.marketingConsent) {
      await log("blocked_no_consent");
      return "blocked_no_consent";
    }
  } else if (suppressed && suppressed.reason !== "unsubscribed") {
    // Unsubscribing from marketing doesn't stop booking confirmations; bounces/complaints do.
    await log("suppressed");
    return "suppressed";
  }

  let text = body;
  const headers: Record<string, string> = {};
  if (kind === "marketing") {
    const url = unsubscribeUrl(address);
    text += `\n\nUnsubscribe at any time: ${url}`;
    headers["List-Unsubscribe"] = `<${url}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const transport = emailTransport();
  try {
    await transport.send({ to: address, subject, text, headers });
  } catch (err) {
    await log("failed");
    throw err;
  }
  const status: SendResult = transport.name === "mock" ? "mock_sent" : "sent";
  await log(status);
  return status;
}
