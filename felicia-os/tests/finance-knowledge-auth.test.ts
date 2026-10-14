import { describe, it, expect, beforeEach } from "vitest";
import { harness, MONDAY, type Harness } from "./helpers";
import { requestBooking } from "@/lib/booking/booking";
import { applyPaymentEvent } from "@/lib/payments/processing";
import { budgetAlerts, DEFAULT_ASSUMPTIONS, forecast, monthlyActuals, REVENUE_TARGETS_MINOR } from "@/lib/finance/finance";
import { expenses } from "@/lib/db/schema";
import { chunkText, extractText, fetchApprovedUrl, ingestDocument, retrieve } from "@/lib/knowledge/knowledge";
import { can, createUser, hashPassword, login, readSessionToken, verifyPassword } from "@/lib/auth/auth";
import { authenticator } from "otplib";
import { updateService, getService } from "@/lib/services/catalogue";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe("financial reports reconcile against test transactions", () => {
  it("separates cash, recognised, deferred revenue and expenses", async () => {
    const book = async (start: string, key: string, email: string) =>
      (await requestBooking(h.db, { serviceId: "signature-private-session", startsAt: new Date(start), name: "Fictional", email, clientTimezone: "Europe/London", acceptedTerms: true }, key, MONDAY)).bookingId;
    const delivered = await book("2026-01-07T10:00:00Z", "f1", "one@example.test");
    const future = await book("2026-01-14T10:00:00Z", "f2", "two@example.test");
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "e1", providerRef: "pi_1", reference: delivered, amountMinor: 33300, feeMinor: 500, currency: "GBP" });
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "e2", providerRef: "pi_2", reference: future, amountMinor: 33300, feeMinor: 500, currency: "GBP" });
    await h.drainAll();
    await h.db.insert(expenses).values({ id: "exp_1", category: "marketing", description: "Fictional ad test", amountMinor: 60000, incurredOn: "2026-01-09" });

    // "now" is between the two sessions; payments were recorded with real timestamps, so compute for the current month too.
    const now = new Date("2026-01-10T12:00:00Z");
    const jan = await monthlyActuals(h.db, "2026-01", now);
    expect(jan.kind).toBe("actual");
    expect(jan.recognisedRevenueMinor).toBe(33300);
    expect(jan.deferredRevenueMinor).toBe(33300);
    expect(jan.marketingSpendMinor).toBe(60000);
    expect(jan.operatingProfitMinor).toBe(33300 - 60000 - (jan.paymentFeesMinor));
    const alerts = await budgetAlerts(h.db, "2026-01", now);
    expect(alerts.map((a) => a.rule)).toContain("marketing_over_budget");
  });

  it("forecasts are labelled, scenario-based and editable", () => {
    const base = forecast("base", DEFAULT_ASSUMPTIONS.base, "2026-11", 24);
    expect(base.kind).toBe("forecast");
    expect(base.months).toHaveLength(24);
    const cons = forecast("conservative", DEFAULT_ASSUMPTIONS.conservative, "2026-11", 24);
    const growth = forecast("growth", DEFAULT_ASSUMPTIONS.growth, "2026-11", 24);
    expect(cons.months[11]!.revenueMinor).toBeLessThan(base.months[11]!.revenueMinor);
    expect(growth.months[11]!.revenueMinor).toBeGreaterThan(base.months[11]!.revenueMinor);
    expect(Object.keys(base.targetReachedMonth).map(Number)).toEqual(REVENUE_TARGETS_MINOR);
    expect(() => forecast("base", { ...DEFAULT_ASSUMPTIONS.base, conversionRatePct: 150 }, "2026-11")).toThrow();
  });
});

describe("knowledge base", () => {
  it("chunks, ingests, versions and retrieves with access control", async () => {
    expect(chunkText("a\n\n".repeat(5000)).length).toBeGreaterThan(1);
    const pub = await ingestDocument(h.db, { title: "Booking policy", section: "L", source: "owner", format: "md", owner: "Felicia", accessLevel: "public", verificationStatus: "verified" }, "Discovery calls are complimentary and last twenty minutes.", "user:t");
    await ingestDocument(h.db, { title: "Draft pricing ideas", section: "G", source: "owner", format: "md", owner: "Felicia", accessLevel: "internal", verificationStatus: "assumption" }, "Discovery calls might become paid next year.", "user:t");
    const publicHits = await retrieve(h.db, "discovery calls", { audience: "public" });
    expect(publicHits.map((x) => x.title)).toEqual(["Booking policy"]);
    const internal = await retrieve(h.db, "discovery calls", { audience: "internal" });
    expect(internal).toHaveLength(2);
    const v2 = await ingestDocument(h.db, { title: "Booking policy", section: "L", source: "owner", format: "md", owner: "Felicia", accessLevel: "public", verificationStatus: "verified", replacesDocumentId: pub.documentId }, "Discovery calls are complimentary and last 20 minutes on Zoom.", "user:t");
    expect(v2.version).toBe(2);
  });

  it("extracts csv/json and refuses unapproved URLs", async () => {
    expect(await extractText("csv", "a,b\n1,2")).toContain("Row 1: 1,2");
    expect(await extractText("json", '{"x":1}')).toContain('"x": 1');
    await expect(fetchApprovedUrl("https://evil.example/")).rejects.toThrow(/not approved/);
    await expect(fetchApprovedUrl("http://metamastermindz.com/")).rejects.toThrow(/not approved/);
  });
});

describe("authentication and permissions", () => {
  it("hashes passwords, enforces MFA for admins and locks out brute force", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow();

    const { totpSecret } = await createUser(h.db, { email: "owner@example.test", name: "Owner (fictional)", role: "owner", password: "a-long-test-password" });
    expect(totpSecret).toBeTruthy();
    const noCode = await login(h.db, "owner@example.test", "a-long-test-password");
    expect(noCode.ok).toBe(false);
    const ok = await login(h.db, "owner@example.test", "a-long-test-password", authenticator.generate(totpSecret!));
    expect(ok.ok).toBe(true);
    const session = await readSessionToken(ok.ok ? ok.token : undefined);
    expect(session?.role).toBe("owner");
    expect(await readSessionToken("garbage")).toBeNull();

    for (let i = 0; i < 5; i++) await login(h.db, "owner@example.test", "bad-password-attempt");
    const locked = await login(h.db, "owner@example.test", "a-long-test-password", authenticator.generate(totpSecret!));
    expect(locked.ok).toBe(false);
  });

  it("role-based permissions", () => {
    expect(can("owner", "intake.read")).toBe(true);
    expect(can("admin", "intake.read")).toBe(false);
    expect(can("staff", "approvals.decide")).toBe(false);
    expect(can("viewer", "dashboard.view")).toBe(true);
  });

  it("administrators can edit services without code; changes are validated and audited", async () => {
    await updateService(h.db, "signature-private-session", { priceMinor: 35500, status: "active" }, "user:owner");
    const s = await getService(h.db, "signature-private-session");
    expect(s!.priceMinor).toBe(35500);
    expect(s!.ownerApprovedPrice).toBe(true);
    await expect(updateService(h.db, "signature-private-session", { priceMinor: 100, priceMaxMinor: 50 }, "user:owner")).rejects.toThrow();
  });
});
