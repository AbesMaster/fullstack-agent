import { env } from "../config/env";

/**
 * CRM records carry ONLY the minimum necessary contact data. Intake answers,
 * health screening and session notes never leave FELICIA OS's encrypted store.
 */
export type CrmContact = {
  email: string;
  name: string;
  phone?: string | null;
  lifecycleStage: string;
  source: string;
  marketingConsent: boolean;
};

const FORBIDDEN_KEYS = /health|medical|diagnos|medication|condition|intake|symptom|pregnan|trauma|notes/i;

/** Guard: refuses to send anything that looks like sensitive data to the CRM. */
export function assertNoSensitiveFields(props: Record<string, unknown>) {
  for (const k of Object.keys(props)) {
    if (FORBIDDEN_KEYS.test(k)) throw new Error(`Refusing to sync sensitive field "${k}" to CRM`);
  }
}

export interface CrmProvider {
  readonly name: "hubspot" | "mock";
  upsertContact(c: CrmContact): Promise<{ externalId: string; created: boolean }>;
  recordDeal(externalContactId: string, deal: { name: string; amountMinor: number; stage: string; reference: string }): Promise<{ dealId: string }>;
}

export class HubSpotProvider implements CrmProvider {
  readonly name = "hubspot" as const;
  constructor(private token: string, private fetchImpl: typeof fetch = fetch) {}

  /** Read-only launch check: the private app token can read contacts. */
  async verifyConnection() {
    await this.call("/crm/v3/objects/contacts?limit=1", { method: "GET" });
    return { ok: true as const };
  }

  private async call(path: string, init: RequestInit) {
    const res = await this.fetchImpl(`https://api.hubapi.com${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 429) throw new Error("HubSpot rate limited (will retry)");
    if (!res.ok) throw new Error(`HubSpot ${init.method ?? "GET"} ${path} failed: ${res.status}`);
    return res.status === 204 ? {} : res.json();
  }

  async upsertContact(c: CrmContact) {
    const [firstname, ...rest] = c.name.trim().split(/\s+/);
    const properties = {
      email: c.email,
      firstname,
      lastname: rest.join(" "),
      phone: c.phone ?? undefined,
      lifecyclestage: mapLifecycle(c.lifecycleStage),
      hs_lead_status: c.lifecycleStage === "lead" ? "NEW" : undefined,
      felicia_source: c.source,
      felicia_marketing_consent: String(c.marketingConsent),
    };
    assertNoSensitiveFields(properties);
    const search = (await this.call("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: c.email }] }], limit: 1 }),
    })) as { results?: { id: string }[] };
    const existing = search.results?.[0];
    if (existing) {
      await this.call(`/crm/v3/objects/contacts/${existing.id}`, { method: "PATCH", body: JSON.stringify({ properties }) });
      return { externalId: existing.id, created: false };
    }
    const created = (await this.call("/crm/v3/objects/contacts", { method: "POST", body: JSON.stringify({ properties }) })) as { id: string };
    return { externalId: created.id, created: true };
  }

  async recordDeal(externalContactId: string, deal: { name: string; amountMinor: number; stage: string; reference: string }) {
    const created = (await this.call("/crm/v3/objects/deals", {
      method: "POST",
      body: JSON.stringify({
        properties: { dealname: deal.name, amount: (deal.amountMinor / 100).toFixed(2), dealstage: deal.stage, felicia_reference: deal.reference },
        associations: [{ to: { id: externalContactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
      }),
    })) as { id: string };
    return { dealId: created.id };
  }
}

function mapLifecycle(stage: string) {
  return ({ subscriber: "subscriber", lead: "lead", discovery: "opportunity", client: "customer", returning_client: "customer" } as Record<string, string>)[stage] ?? "lead";
}

export class MockCrmProvider implements CrmProvider {
  readonly name = "mock" as const;
  contacts = new Map<string, CrmContact & { id: string }>();
  deals: { id: string; contactId: string; name: string; amountMinor: number; stage: string; reference: string }[] = [];

  async upsertContact(c: CrmContact) {
    assertNoSensitiveFields(c as unknown as Record<string, unknown>);
    const existing = this.contacts.get(c.email);
    if (existing) {
      this.contacts.set(c.email, { ...existing, ...c });
      return { externalId: existing.id, created: false };
    }
    const id = `mock_hs_${this.contacts.size + 1}`;
    this.contacts.set(c.email, { ...c, id });
    return { externalId: id, created: true };
  }

  async recordDeal(contactId: string, deal: { name: string; amountMinor: number; stage: string; reference: string }) {
    const existing = this.deals.find((d) => d.reference === deal.reference);
    if (existing) return { dealId: existing.id };
    const id = `mock_deal_${this.deals.length + 1}`;
    this.deals.push({ id, contactId, ...deal });
    return { dealId: id };
  }
}

let override: CrmProvider | undefined;
let devSingleton: MockCrmProvider | undefined;
export function setCrmProviderForTests(p: CrmProvider | undefined) {
  override = p;
}
export function crmProvider(): CrmProvider {
  if (override) return override;
  const t = env().HUBSPOT_ACCESS_TOKEN;
  if (t) return new HubSpotProvider(t);
  return (devSingleton ??= new MockCrmProvider());
}
