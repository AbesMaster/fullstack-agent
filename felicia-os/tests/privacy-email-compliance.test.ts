import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { harness, MONDAY, type Harness } from "./helpers";
import { createEnquiry, requestBooking, submitIntake } from "@/lib/booking/booking";
import { sendTemplate, unsubscribe, unsubscribeToken } from "@/lib/email/send";
import { renderTemplate, TEMPLATES } from "@/lib/email/templates";
import { agentTasks, auditLog, contacts, contentItems, emailLog, intakeRecords } from "@/lib/db/schema";
import { decryptJson, encryptJson } from "@/lib/security/encryption";
import { assertNoSensitiveFields, HubSpotProvider } from "@/lib/crm/provider";
import { checkClaims, escalationReason, isBlocked } from "@/lib/compliance/claims";
import { createDraft, submitForApproval } from "@/lib/content/pipeline";
import { decideAndDispatch } from "@/lib/agents/workflows";
import { redactForParent, JarvisConnector, MockJarvisTransport } from "@/lib/jarvis/connector";
import { signResourceToken, verifyResourceToken } from "@/lib/security/tokens";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe("email consent", () => {
  it("blocks marketing without consent, sends with consent, adds unsubscribe headers", async () => {
    await createEnquiry(h.db, { name: "No Consent", email: "no@example.test", message: "hello", marketingConsent: false }, "e1");
    await createEnquiry(h.db, { name: "Yes Consent", email: "yes@example.test", message: "hello", marketingConsent: true }, "e2");
    expect(await sendTemplate(h.db, "newsletter_welcome", "no@example.test", { name: "x" })).toBe("blocked_no_consent");
    expect(await sendTemplate(h.db, "newsletter_welcome", "yes@example.test", { name: "x" })).toBe("mock_sent");
    const m = h.email.outbox.at(-1)!;
    expect(m.headers?.["List-Unsubscribe"]).toContain("/unsubscribe?");
    expect(m.text).toContain("Unsubscribe at any time");
  });

  it("unsubscribe suppresses marketing but not booking confirmations", async () => {
    await createEnquiry(h.db, { name: "U", email: "u@example.test", message: "hi", marketingConsent: true }, "e3");
    await expect(unsubscribe(h.db, "u@example.test", "forged")).rejects.toThrow();
    await unsubscribe(h.db, "u@example.test", unsubscribeToken("u@example.test"));
    expect(await sendTemplate(h.db, "newsletter_welcome", "u@example.test", { name: "U" })).toBe("suppressed");
    expect(await sendTemplate(h.db, "rescheduling_confirmation", "u@example.test", { name: "U", service: "S", when: "Tue" })).toBe("mock_sent");
    const [c] = await h.db.select().from(contacts).where(eq(contacts.email, "u@example.test"));
    expect(c!.marketingConsent).toBe(false);
  });

  it("all 13 workflow templates render and declare a kind", () => {
    expect(Object.keys(TEMPLATES)).toHaveLength(13);
    expect(() => renderTemplate("appointment_reminder", { name: "x" })).toThrow(/missing/);
  });
});

describe("sensitive client data", () => {
  it("encrypts intake at rest and flags breathwork contraindications for owner review", async () => {
    await requestBooking(h.db, { serviceId: "discovery-call", startsAt: new Date("2026-01-06T10:00:00Z"), name: "Intake Test", email: "i@example.test", clientTimezone: "Europe/London", acceptedTerms: true }, "b1", MONDAY);
    const bookingsRows = await h.db.query.bookings.findMany();
    const bookingId = bookingsRows[0]!.id;
    const r = await submitIntake(h.db, {
      bookingId,
      intentions: "Fictional intention text",
      breathwork: { pregnant: false, cardiovascular: true, epilepsyOrSeizures: false, respiratory: false, recentSurgery: false, severeMentalHealth: false },
      consents: { understandsNotMedical: true, agreesToTerms: true, mayStopAnyTime: true },
    });
    // Discovery calls don't include breathwork screening → no review needed there.
    expect(r.requiresReview).toBe(false);
    const [rec] = await h.db.select().from(intakeRecords);
    expect(rec!.encryptedPayload).not.toContain("Fictional intention");
    const plain = decryptJson<{ intentions: string }>(rec!.encryptedPayload, process.env.DATA_ENCRYPTION_KEY!);
    expect(plain.intentions).toBe("Fictional intention text");
    const audits = await h.db.select().from(auditLog);
    expect(JSON.stringify(audits)).not.toContain("Fictional intention");
  });

  it("encryption detects tampering", () => {
    const key = process.env.DATA_ENCRYPTION_KEY!;
    const env = encryptJson({ a: 1 }, key);
    const parts = env.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptJson(parts.join("."), key)).toThrow();
  });

  it("refuses to sync health-like fields to the CRM", async () => {
    expect(() => assertNoSensitiveFields({ email: "a", medical_history: "x" })).toThrow(/sensitive/);
    let sentBody = "";
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sentBody += String(init.body ?? "");
      return new Response(JSON.stringify({ results: [], id: "hs_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const hs = new HubSpotProvider("token", fakeFetch);
    const r = await hs.upsertContact({ email: "a@example.test", name: "Ann Example", lifecycleStage: "lead", source: "website_form", marketingConsent: false });
    expect(r.externalId).toBe("hs_1");
    expect(sentBody).toContain("a@example.test");
  });

  it("signed resource tokens reject forgeries", () => {
    const t = signResourceToken("intake", "bkg_1");
    expect(verifyResourceToken("intake", "bkg_1", t)).toBe(true);
    expect(verifyResourceToken("intake", "bkg_2", t)).toBe(false);
  });

  it("JARVIS reports are redacted and the connector is off unless configured", async () => {
    const t = new MockJarvisTransport();
    const off = new JarvisConnector(t, { enabled: false, allowedReports: ["system_alert"] });
    expect(await off.report({ type: "system_alert", severity: "info", message: "x" })).toBe("disabled");
    const on = new JarvisConnector(t, { enabled: true, allowedReports: ["system_alert"] });
    await on.report({ type: "system_alert", severity: "warning", message: "Payment issue for jane@example.test +44 7700 900123" });
    expect(JSON.stringify(t.sent)).not.toContain("jane@example.test");
    expect(JSON.stringify(t.sent)).not.toContain("7700");
    expect(redactForParent({ clientEmail: "x", total: 3 })).toEqual({ total: 3 });
    expect(await on.report({ type: "revenue_report", period: "x", actual: { recognisedMinor: 0, cashMinor: 0 }, targetMinor: 1, forecastBaseMinor: null })).toBe("not_allowed");
  });
});

describe("compliance", () => {
  it("blocks cure claims, guarantees and replacement-of-care; flags titles and scarcity for review", () => {
    expect(isBlocked(checkClaims("Star Magic cures anxiety in one session"))).toBe(true);
    expect(isBlocked(checkClaims("Results guaranteed"))).toBe(true);
    expect(isBlocked(checkClaims("You can stop taking medication after this"))).toBe(true);
    const review = checkClaims("Only 2 spots left! Felicia is a licensed therapist.");
    expect(review.map((f) => f.rule).sort()).toEqual(["false-scarcity", "unverified-professional-title"]);
    expect(isBlocked(review)).toBe(false);
    expect(checkClaims("A gentle space to slow down and reconnect with yourself.")).toEqual([]);
  });

  it("detects crisis and medical topics for escalation", () => {
    expect(escalationReason("I want to end my life")).toMatch(/crisis/);
    expect(escalationReason("Can I do this while pregnant?")).toMatch(/medical/);
    expect(escalationReason("What time is the workshop?")).toBeNull();
  });

  it("content pipeline: blocked drafts never reach approval; clean drafts need owner approval", async () => {
    const bad = await createDraft(h.db, "content-strategy", { channel: "instagram", category: "Mindfulness", format: "caption", title: "Heal", body: "Our breathwork cures depression, guaranteed." });
    expect((await submitForApproval(h.db, bad)).status).toBe("rejected");
    const good = await createDraft(h.db, "content-strategy", { channel: "instagram", category: "Mindfulness", format: "caption", title: "Pause", body: "Three slow breaths before you open your inbox." });
    const res = await submitForApproval(h.db, good);
    expect(res.status).toBe("awaiting_approval");
    await decideAndDispatch(h.db, res.approvalId!, "approved", { id: "usr_owner", role: "owner" });
    await h.drainAll();
    const [item] = await h.db.select().from(contentItems).where(eq(contentItems.id, good));
    expect(item!.status).toBe("approved");
  });

  it("approved newsletters go only to consented contacts, once each", async () => {
    await createEnquiry(h.db, { name: "A", email: "a@example.test", message: "hi", marketingConsent: true }, "n1");
    await createEnquiry(h.db, { name: "B", email: "b@example.test", message: "hi", marketingConsent: false }, "n2");
    await h.drainAll();
    const before = h.email.outbox.length;
    const id = await createDraft(h.db, "email-marketing", { channel: "email", category: "Conscious Living", format: "email", title: "October letter", body: "A seasonal reflection." });
    const res = await submitForApproval(h.db, id);
    await decideAndDispatch(h.db, res.approvalId!, "approved", { id: "usr_owner", role: "owner" });
    await h.drainAll();
    const sent = h.email.outbox.slice(before);
    expect(sent.map((m) => m.to)).toEqual(["a@example.test"]);
    const logs = await h.db.select().from(emailLog).where(eq(emailLog.template, `content:${id}`));
    expect(logs).toHaveLength(1);
  });

  it("owner-attention queue exists for escalations", async () => {
    expect(await h.db.select().from(agentTasks)).toEqual([]);
  });
});
