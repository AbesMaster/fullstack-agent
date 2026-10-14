import { SignJWT, importPKCS8 } from "jose";
import { env } from "../config/env";

export type BusyInterval = { start: Date; end: Date };

export interface CalendarProvider {
  readonly name: "google" | "mock";
  busy(from: Date, to: Date): Promise<BusyInterval[]>;
  createEvent(e: { summary: string; start: Date; end: Date; description: string; idempotencyKey: string }): Promise<{ eventId: string }>;
  deleteEvent(eventId: string): Promise<void>;
}

/**
 * Google Calendar via a service account with the calendar shared to it.
 * The event description never contains intake or health details.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "google" as const;
  private token?: { value: string; exp: number };
  constructor(private calendarId: string, private sa: { client_email: string; private_key: string }, private fetchImpl: typeof fetch = fetch) {}

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const key = await importPKCS8(this.sa.private_key, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/calendar" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.sa.client_email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async api(path: string, init: RequestInit = {}) {
    const res = await this.fetchImpl(`https://www.googleapis.com/calendar/v3${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
    });
    if (!res.ok && res.status !== 409) throw new Error(`Google Calendar ${path} failed: ${res.status}`);
    return res.status === 204 ? {} : res.json();
  }

  async busy(from: Date, to: Date) {
    const j = (await this.api("/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: this.calendarId }] }),
    })) as { calendars: Record<string, { busy: { start: string; end: string }[] }> };
    return (j.calendars[this.calendarId]?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  async createEvent(e: { summary: string; start: Date; end: Date; description: string; idempotencyKey: string }) {
    // Google event ids must be base32hex; derive one from the idempotency key so retries don't duplicate.
    const id = Buffer.from(e.idempotencyKey).toString("hex").slice(0, 60).replace(/[^0-9a-v]/g, "a");
    await this.api(`/calendars/${encodeURIComponent(this.calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify({ id, summary: e.summary, description: e.description, start: { dateTime: e.start.toISOString() }, end: { dateTime: e.end.toISOString() } }),
    });
    return { eventId: id };
  }

  async deleteEvent(eventId: string) {
    await this.api(`/calendars/${encodeURIComponent(this.calendarId)}/events/${eventId}`, { method: "DELETE" });
  }
}

export class MockCalendarProvider implements CalendarProvider {
  readonly name = "mock" as const;
  events = new Map<string, { summary: string; start: Date; end: Date }>();
  externalBusy: BusyInterval[] = [];

  async busy(from: Date, to: Date) {
    const all = [...this.externalBusy, ...[...this.events.values()].map((e) => ({ start: e.start, end: e.end }))];
    return all.filter((b) => b.start < to && b.end > from);
  }
  async createEvent(e: { summary: string; start: Date; end: Date; idempotencyKey: string }) {
    const eventId = `mock_evt_${e.idempotencyKey}`;
    if (!this.events.has(eventId)) this.events.set(eventId, { summary: e.summary, start: e.start, end: e.end });
    return { eventId };
  }
  async deleteEvent(eventId: string) {
    this.events.delete(eventId);
  }
}

let override: CalendarProvider | undefined;
let devSingleton: MockCalendarProvider | undefined;
export function setCalendarProviderForTests(p: CalendarProvider | undefined) {
  override = p;
}
export function calendarProvider(): CalendarProvider {
  if (override) return override;
  const e = env();
  if (e.GOOGLE_CALENDAR_ID && e.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return new GoogleCalendarProvider(e.GOOGLE_CALENDAR_ID, JSON.parse(e.GOOGLE_SERVICE_ACCOUNT_JSON));
  }
  return (devSingleton ??= new MockCalendarProvider());
}
