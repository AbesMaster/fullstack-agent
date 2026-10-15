import { env } from "../config/env";

/**
 * Video meetings for online sessions and events.
 *
 * Only the attendee join link and passcode are ever stored or emailed. The host
 * "start" link is deliberately discarded: it lets anyone start the meeting as Felicia,
 * so she starts meetings from her own signed-in Zoom app instead.
 */
export type MeetingRequest = { topic: string; start: Date; durationMinutes: number; timezone: string; agenda?: string; idempotencyKey: string };
export type Meeting = { meetingId: string; joinUrl: string; passcode: string | null };

export interface VideoProvider {
  readonly name: "zoom" | "mock" | "unconnected";
  createMeeting(m: MeetingRequest): Promise<Meeting>;
  updateMeeting(meetingId: string, m: { start: Date; durationMinutes: number; timezone: string; topic?: string }): Promise<void>;
  deleteMeeting(meetingId: string): Promise<void>;
}

export class VideoError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

/** Zoom via a Server-to-Server OAuth app (scopes: meeting:write:meeting:admin, meeting:update:meeting:admin, meeting:delete:meeting:admin). */
export class ZoomProvider implements VideoProvider {
  readonly name = "zoom" as const;
  private token?: { value: string; exp: number };

  constructor(
    private cfg: { accountId: string; clientId: string; clientSecret: string; hostUser: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  /** Read-only launch check: can we sign in, and is the host on a paid (licensed) plan? */
  async verifyConnection() {
    const u = (await this.api(`/users/${encodeURIComponent(this.cfg.hostUser)}`, { method: "GET" })) as { email?: string; type?: number };
    return { host: u.email ?? this.cfg.hostUser, licensed: u.type === 2 };
  }

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(this.cfg.accountId)}`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new VideoError(`Zoom sign-in failed (${res.status}). Check the Zoom app credentials.`, res.status >= 500);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async api(path: string, init: RequestInit) {
    const res = await this.fetchImpl(`https://api.zoom.us/v2${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
    });
    if (res.status === 401) this.token = undefined; // force a fresh token on retry
    if (!res.ok && !(init.method === "DELETE" && res.status === 404)) {
      throw new VideoError(`Zoom ${init.method} ${path} failed (${res.status})`, res.status === 401 || res.status === 429 || res.status >= 500);
    }
    return res.status === 204 || init.method === "DELETE" ? null : res.json();
  }

  async createMeeting(m: MeetingRequest): Promise<Meeting> {
    const j = (await this.api(`/users/${encodeURIComponent(this.cfg.hostUser)}/meetings`, {
      method: "POST",
      body: JSON.stringify({
        topic: m.topic.slice(0, 200),
        type: 2, // scheduled
        start_time: m.start.toISOString().replace(/\.\d{3}Z$/, "Z"),
        duration: m.durationMinutes,
        timezone: m.timezone,
        agenda: m.agenda?.slice(0, 2000),
        settings: {
          waiting_room: true, // Felicia admits each person
          join_before_host: false,
          mute_upon_entry: true,
          approval_type: 2, // no registration
          auto_recording: "none", // never record sessions
          meeting_authentication: false,
        },
      }),
    })) as { id: number; join_url: string; password?: string };
    return { meetingId: String(j.id), joinUrl: j.join_url, passcode: j.password ?? null };
  }

  async updateMeeting(meetingId: string, m: { start: Date; durationMinutes: number; timezone: string; topic?: string }) {
    await this.api(`/meetings/${encodeURIComponent(meetingId)}`, {
      method: "PATCH",
      body: JSON.stringify({ start_time: m.start.toISOString().replace(/\.\d{3}Z$/, "Z"), duration: m.durationMinutes, timezone: m.timezone, ...(m.topic ? { topic: m.topic.slice(0, 200) } : {}) }),
    });
  }

  async deleteMeeting(meetingId: string) {
    await this.api(`/meetings/${encodeURIComponent(meetingId)}`, { method: "DELETE" });
  }
}

/** Development/test stand-in. Links are clearly fake and never point at a real meeting. */
export class MockVideoProvider implements VideoProvider {
  readonly name = "mock" as const;
  meetings = new Map<string, MeetingRequest & { deleted?: boolean }>();
  private byKey = new Map<string, string>();
  failNext = 0;

  async createMeeting(m: MeetingRequest) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new VideoError("Mock Zoom outage", true);
    }
    // Same idempotency key → same meeting, so a retried workflow never creates a duplicate.
    const existing = this.byKey.get(m.idempotencyKey);
    const id = existing ?? `mock-${this.meetings.size + 1}`;
    if (!existing) {
      this.byKey.set(m.idempotencyKey, id);
      this.meetings.set(id, { ...m });
    }
    return { meetingId: id, joinUrl: `https://example.invalid/mock-zoom/${id}`, passcode: "000000" };
  }
  async updateMeeting(meetingId: string, m: { start: Date; durationMinutes: number; timezone: string }) {
    const cur = this.meetings.get(meetingId);
    if (cur) this.meetings.set(meetingId, { ...cur, start: m.start, durationMinutes: m.durationMinutes, timezone: m.timezone });
  }
  async deleteMeeting(meetingId: string) {
    const cur = this.meetings.get(meetingId);
    if (cur) cur.deleted = true;
  }
}

/** Production without Zoom credentials: every call fails clearly so the owner is alerted. */
export class UnconnectedVideoProvider implements VideoProvider {
  readonly name = "unconnected" as const;
  private fail(): never {
    throw new VideoError("Zoom isn't connected yet, so no meeting link was created. Add the Zoom app details, then retry.", false);
  }
  async createMeeting(): Promise<Meeting> {
    this.fail();
  }
  async updateMeeting() {
    this.fail();
  }
  async deleteMeeting() {
    this.fail();
  }
}

let override: VideoProvider | undefined;
let devSingleton: MockVideoProvider | undefined;
export function setVideoProviderForTests(p: VideoProvider | undefined) {
  override = p;
}
export function videoProvider(): VideoProvider {
  if (override) return override;
  const e = env();
  if (e.ZOOM_ACCOUNT_ID && e.ZOOM_CLIENT_ID && e.ZOOM_CLIENT_SECRET) {
    return new ZoomProvider({ accountId: e.ZOOM_ACCOUNT_ID, clientId: e.ZOOM_CLIENT_ID, clientSecret: e.ZOOM_CLIENT_SECRET, hostUser: e.ZOOM_HOST_USER });
  }
  // Never send real clients a made-up link: in production, a missing Zoom app is a visible failure.
  if (e.APP_ENV === "production") return new UnconnectedVideoProvider();
  return (devSingleton ??= new MockVideoProvider());
}

/** The paragraph clients receive. */
export function joinInstructions(m: { videoJoinUrl: string | null; videoPasscode: string | null } | undefined) {
  if (!m?.videoJoinUrl) return "";
  return `Join on Zoom: ${m.videoJoinUrl}${m.videoPasscode ? `\nPasscode: ${m.videoPasscode}` : ""}\nYou'll wait briefly in a waiting room until Felicia lets you in. Find a quiet, private space, and test your camera and sound beforehand. Sessions are never recorded.`;
}
