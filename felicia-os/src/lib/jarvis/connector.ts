import { createHmac } from "node:crypto";
import { env } from "../config/env";

/**
 * JARVIS CONNECTOR INTERFACE
 *
 * No JARVIS OS documentation, API schema or credentials were available when this
 * was built, so NO endpoints are assumed. This file defines the contract FELICIA OS
 * offers to a parent system, a privacy filter that every outbound report passes
 * through, a mock transport for tests, and a generic signed-webhook transport that
 * can be pointed at JARVIS once its real spec is supplied (see docs/JARVIS_CONNECTOR.md).
 */

export type JarvisReport =
  | { type: "business_status"; period: string; actualRevenueMinor: number | null; bookings: number; pendingApprovals: number; systemHealth: "ok" | "degraded" | "halted" }
  | { type: "agent_performance"; period: string; agents: { agentId: string; succeeded: number; failed: number; blocked: number }[] }
  | { type: "revenue_report"; period: string; actual: { recognisedMinor: number; cashMinor: number }; targetMinor: number; forecastBaseMinor: number | null }
  | { type: "system_alert"; severity: "info" | "warning" | "critical"; message: string };

export type JarvisTask = { taskId: string; kind: string; summary: string; requestedBy: string };

export interface JarvisTransport {
  readonly name: string;
  send(report: JarvisReport): Promise<void>;
  /** Tasks JARVIS has delegated. They are NEVER executed directly — each becomes an approval request. */
  pullTasks(): Promise<JarvisTask[]>;
}

/* ---------------- Privacy filter ---------------- */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const PII_KEYS = /^(email|name|phone|contact|client|address|intake|health|notes)/i;

/** Strips client-identifying data. Reports are aggregate by design; this is defence in depth. */
export function redactForParent<T>(value: T): T {
  if (typeof value === "string") return value.replace(EMAIL, "[redacted-email]").replace(PHONE, "[redacted-phone]") as T;
  if (Array.isArray(value)) return value.map((v) => redactForParent(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (PII_KEYS.test(k) && k !== "type") continue;
      out[k] = redactForParent(v);
    }
    return out as T;
  }
  return value;
}

/* ---------------- Transports ---------------- */

export class MockJarvisTransport implements JarvisTransport {
  readonly name = "mock";
  sent: JarvisReport[] = [];
  queued: JarvisTask[] = [];
  async send(r: JarvisReport) {
    this.sent.push(r);
  }
  async pullTasks() {
    const t = this.queued;
    this.queued = [];
    return t;
  }
}

/** Generic HMAC-signed webhook transport. Paths are configuration, not assumptions about JARVIS. */
export class SignedWebhookTransport implements JarvisTransport {
  readonly name = "signed-webhook";
  constructor(private baseUrl: string, private token: string, private paths = { reports: "/felicia/reports", tasks: "/felicia/tasks" }, private fetchImpl: typeof fetch = fetch) {}
  private sign(body: string, ts: number) {
    return createHmac("sha256", this.token).update(`${ts}.${body}`).digest("hex");
  }
  async send(r: JarvisReport) {
    const body = JSON.stringify(r);
    const ts = Math.floor(Date.now() / 1000);
    const res = await this.fetchImpl(new URL(this.paths.reports, this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-felicia-timestamp": String(ts), "x-felicia-signature": this.sign(body, ts) },
      body,
    });
    if (!res.ok) throw new Error(`JARVIS report failed: ${res.status}`);
  }
  async pullTasks() {
    const res = await this.fetchImpl(new URL(this.paths.tasks, this.baseUrl), { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`JARVIS task pull failed: ${res.status}`);
    return (await res.json()) as JarvisTask[];
  }
}

export class JarvisConnector {
  constructor(private transport: JarvisTransport, private policy: { enabled: boolean; allowedReports: JarvisReport["type"][] }) {}

  async report(r: JarvisReport): Promise<"sent" | "disabled" | "not_allowed"> {
    if (!this.policy.enabled) return "disabled";
    if (!this.policy.allowedReports.includes(r.type)) return "not_allowed";
    await this.transport.send(redactForParent(r));
    return "sent";
  }

  async delegatedTasks() {
    return this.policy.enabled ? this.transport.pullTasks() : [];
  }
}

let override: JarvisConnector | undefined;
export function setJarvisForTests(c: JarvisConnector | undefined) {
  override = c;
}
export function jarvis(): JarvisConnector {
  if (override) return override;
  const e = env();
  const allowedReports: JarvisReport["type"][] = ["business_status", "agent_performance", "revenue_report", "system_alert"];
  if (e.JARVIS_BASE_URL && e.JARVIS_API_TOKEN) return new JarvisConnector(new SignedWebhookTransport(e.JARVIS_BASE_URL, e.JARVIS_API_TOKEN), { enabled: true, allowedReports });
  return new JarvisConnector(new MockJarvisTransport(), { enabled: false, allowedReports });
}
