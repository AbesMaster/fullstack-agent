import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, rateLimit } from "@/lib/server";
import { answerVisitor } from "@/lib/agents/conversation";
import { isEmergencyStopped } from "@/lib/agents/controls";

const Body = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(12).default([]),
});

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    await rateLimit("chat", 15);
    const d = await db();
    if (await isEmergencyStopped(d)) return NextResponse.json({ reply: "The assistant is paused right now. Please use the contact form and the team will reply personally.", link: "/contact" });
    const { message, history } = Body.parse(await req.json());
    return NextResponse.json(await answerVisitor(d, history, message));
  });
}
