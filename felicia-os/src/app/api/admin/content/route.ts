import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, requireUser } from "@/lib/server";
import { createDraft, submitForApproval } from "@/lib/content/pipeline";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), draft: z.record(z.string()) }),
  z.object({ action: z.literal("submit"), id: z.string() }),
]);

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await requireUser("content.manage");
    const b = Body.parse(await req.json());
    const d = await db();
    if (b.action === "draft") {
      // Human-authored drafts are filed under the Content Strategy agent's queue.
      const id = await createDraft(d, "content-strategy", b.draft as never);
      return NextResponse.json({ id }, { status: 201 });
    }
    const r = await submitForApproval(d, b.id);
    return NextResponse.json({ status: r.status, flags: r.flags });
  });
}
