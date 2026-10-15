import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { bookings, programmeEvents, services } from "../db/schema";
import { videoProvider, VideoError } from "./provider";
import { assertTool } from "../agents/controls";
import { audit } from "../audit/audit";

/**
 * Keeps Zoom meetings in step with bookings and online events.
 * Every function is idempotent: safe to call again after a partial failure or retry.
 */

export async function ensureBookingMeeting(db: DB, bookingId: string, agentId = "scheduling") {
  const [row] = await db.select({ b: bookings, s: services }).from(bookings).innerJoin(services, eq(bookings.serviceId, services.id)).where(eq(bookings.id, bookingId));
  if (!row) throw new Error(`Booking ${bookingId} missing`);
  const { b, s } = row;
  if (b.attendanceMode !== "online" || b.status === "cancelled") return null;
  if (b.videoJoinUrl) return b;
  assertTool(agentId, "video.manage");
  const m = await videoProvider().createMeeting({
    topic: `${s.name} with Felicia Stefan`,
    start: b.startsAt,
    durationMinutes: Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000),
    timezone: "Europe/London",
    agenda: "MetaMasterMindz session", // no client name or details in Zoom
    idempotencyKey: `booking:${b.id}`,
  });
  const [updated] = await db.update(bookings).set({ videoMeetingId: m.meetingId, videoJoinUrl: m.joinUrl, videoPasscode: m.passcode }).where(eq(bookings.id, b.id)).returning();
  await audit(db, { actor: `agent:${agentId}`, action: "video.meeting_created", target: b.id, metadata: { provider: videoProvider().name } });
  return updated!;
}

export async function moveBookingMeeting(db: DB, bookingId: string, agentId = "scheduling") {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b) return;
  if (!b.videoMeetingId) return ensureBookingMeeting(db, bookingId, agentId);
  assertTool(agentId, "video.manage");
  await videoProvider().updateMeeting(b.videoMeetingId, { start: b.startsAt, durationMinutes: Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000), timezone: "Europe/London" });
  return b;
}

export async function deleteBookingMeeting(db: DB, bookingId: string, agentId = "scheduling") {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b?.videoMeetingId) return;
  assertTool(agentId, "video.manage");
  await videoProvider().deleteMeeting(b.videoMeetingId);
  await db.update(bookings).set({ videoMeetingId: null, videoJoinUrl: null, videoPasscode: null }).where(eq(bookings.id, b.id));
  await audit(db, { actor: `agent:${agentId}`, action: "video.meeting_deleted", target: b.id });
}

/** Online events share one meeting for all attendees, created when first needed. */
export async function ensureEventMeeting(db: DB, eventId: string, agentId = "events") {
  const [ev] = await db.select().from(programmeEvents).where(eq(programmeEvents.id, eventId));
  if (!ev || !ev.isOnline || ev.status === "cancelled") return null;
  if (ev.videoJoinUrl) return ev;
  assertTool(agentId, "video.manage");
  const m = await videoProvider().createMeeting({
    topic: ev.title,
    start: ev.startsAt,
    durationMinutes: Math.round((ev.endsAt.getTime() - ev.startsAt.getTime()) / 60_000),
    timezone: "Europe/London",
    agenda: "MetaMasterMindz group experience",
    idempotencyKey: `event:${ev.id}`,
  });
  const [updated] = await db.update(programmeEvents).set({ videoMeetingId: m.meetingId, videoJoinUrl: m.joinUrl, videoPasscode: m.passcode }).where(eq(programmeEvents.id, ev.id)).returning();
  await audit(db, { actor: `agent:${agentId}`, action: "video.meeting_created", target: ev.id, metadata: { provider: videoProvider().name } });
  return updated!;
}

/**
 * After an admin edits an online event: move the meeting to the new time, or delete it
 * if the event was cancelled or is no longer online. Failures are reported, not thrown:
 * a Zoom join link keeps working even if its scheduled time is stale.
 */
export async function syncEventMeeting(db: DB, eventId: string, actor: string) {
  const [ev] = await db.select().from(programmeEvents).where(eq(programmeEvents.id, eventId));
  if (!ev?.videoMeetingId) return { ok: true as const };
  try {
    if (ev.status === "cancelled" || !ev.isOnline) {
      await videoProvider().deleteMeeting(ev.videoMeetingId);
      await db.update(programmeEvents).set({ videoMeetingId: null, videoJoinUrl: null, videoPasscode: null }).where(eq(programmeEvents.id, ev.id));
      await audit(db, { actor, action: "video.meeting_deleted", target: ev.id });
    } else {
      await videoProvider().updateMeeting(ev.videoMeetingId, { start: ev.startsAt, durationMinutes: Math.round((ev.endsAt.getTime() - ev.startsAt.getTime()) / 60_000), timezone: "Europe/London", topic: ev.title });
    }
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof VideoError ? err.message : "Zoom update failed";
    await audit(db, { actor, action: "video.meeting_sync_failed", target: ev.id, metadata: { message } });
    return { ok: false as const, message };
  }
}
