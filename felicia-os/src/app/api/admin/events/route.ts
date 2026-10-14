import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, requireUser } from "@/lib/server";
import { cancelRegistration, createEvent, EventError, updateEvent } from "@/lib/programme/events";
import { fromZonedInputValue } from "@/lib/booking/time";

/** Converts UK wall-clock form values (startsAtLocal/endsAtLocal) into real instants. */
function withLondonTimes(v: Record<string, unknown>) {
  try {
    return convert(v);
  } catch {
    throw new EventError("invalid", "Please enter a valid start and end date and time.");
  }
}
function convert(v: Record<string, unknown>) {
  const { startsAtLocal, endsAtLocal, ...rest } = v;
  return {
    ...rest,
    ...(typeof startsAtLocal === "string" ? { startsAt: fromZonedInputValue(startsAtLocal) } : {}),
    ...(typeof endsAtLocal === "string" ? { endsAt: fromZonedInputValue(endsAtLocal) } : {}),
  };
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), event: z.record(z.unknown()) }),
  z.object({ action: z.literal("update"), id: z.string(), patch: z.record(z.unknown()) }),
  z.object({ action: z.literal("cancel_registration"), registrationId: z.string(), reason: z.string().min(1).max(500) }),
]);

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const u = await requireUser("events.manage");
    const b = Body.parse(await req.json());
    const d = await db();
    const actor = `user:${u.id}`;
    if (b.action === "create") return NextResponse.json({ id: await createEvent(d, withLondonTimes(b.event) as never, actor) }, { status: 201 });
    if (b.action === "update") return NextResponse.json({ event: await updateEvent(d, b.id, withLondonTimes(b.patch) as never, actor) });
    await cancelRegistration(d, b.registrationId, actor, b.reason);
    return NextResponse.json({ ok: true });
  });
}
