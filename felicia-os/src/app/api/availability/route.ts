import { NextResponse } from "next/server";
import { db, handle, rateLimit } from "@/lib/server";
import { getService } from "@/lib/services/catalogue";
import { availableSlots } from "@/lib/booking/booking";

export async function GET(req: Request) {
  return handle(async () => {
    await rateLimit("availability", 60);
    const id = new URL(req.url).searchParams.get("service") ?? "";
    const s = await getService(await db(), id);
    if (!s || !["active", "proposed"].includes(s.status)) return NextResponse.json({ error: "Unknown service" }, { status: 404 });
    const slots = await availableSlots(await db(), s, { days: 21 });
    return NextResponse.json({ service: { id: s.id, name: s.name, durationMinutes: s.durationMinutes, priceMinor: s.priceMinor }, slots: slots.slice(0, 200).map((x) => x.start.toISOString()) });
  });
}
