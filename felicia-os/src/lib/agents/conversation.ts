import { z } from "zod/v4";
import type { DB } from "../db/client";
import { agentTasks } from "../db/schema";
import { listServices } from "../services/catalogue";
import { retrieve } from "../knowledge/knowledge";
import { CRISIS_RESPONSE, escalationReason } from "../compliance/claims";
import { asData, draftStructured, llmAvailable } from "../ai/claude";
import { formatPriceRange, newId } from "../util";
import { SITE } from "../site";

/**
 * Client Conversation agent (website chat). Always identifies as AI, never impersonates
 * Felicia, never gives medical advice, shares only PUBLISHED prices and VERIFIED public knowledge.
 */
export const AI_INTRO = "I'm the MetaMasterMindz AI assistant (not Felicia).";

const ReplySchema = z.object({
  reply: z.string().describe("Warm, concise answer in plain British English, max ~120 words"),
  escalate: z.boolean().describe("True if Felicia should personally follow up"),
  suggestedLink: z.enum(["/book?service=discovery-call", "/contact", "/sessions", "/programmes", "/events", "/faq", "none"]),
});

export type ChatTurn = { role: "user" | "assistant"; text: string };

export async function answerVisitor(db: DB, history: ChatTurn[], message: string) {
  const reason = escalationReason(message);
  if (reason?.startsWith("possible crisis")) {
    await flag(db, reason, message);
    return { reply: CRISIS_RESPONSE, escalated: true, link: null as string | null, mode: "safety" as const };
  }
  if (reason === "medical question") {
    await flag(db, reason, message);
    return {
      reply: `${AI_INTRO} I can't give medical advice. ${SITE.wellbeingDisclaimer} Felicia reviews health questions personally — please use the contact form, and she'll get back to you.`,
      escalated: true,
      link: "/contact",
      mode: "safety" as const,
    };
  }

  const services = await listServices(db, { publicOnly: true });
  const catalogue = services
    .map((s) => `- ${s.name}: ${formatPriceRange(s.priceMinor, s.priceMaxMinor)}${s.priceUnit === "per_participant" ? " per person" : ""}${s.durationMinutes ? `, ${s.durationMinutes} min` : ""}${s.ownerApprovedPrice ? "" : " (pricing being finalised)"}. ${s.description}`)
    .join("\n");
  const knowledge = await retrieve(db, message, { audience: "public", k: 4 });

  if (!llmAvailable()) return { ...fallbackAnswer(message, services), escalated: false, mode: "rules" as const };

  const out = await draftStructured({
    agentId: "client-conversation",
    tier: "fast",
    schema: ReplySchema,
    instructions: `You are the website chat assistant for ${SITE.name}. Begin your first reply with "${AI_INTRO}". Answer only from the catalogue and verified knowledge below; if the answer isn't there, say you don't know and suggest the contact form. Never quote a price that isn't in the catalogue. Never book, promise availability, or give medical, legal or financial advice. Encourage a free discovery call when someone is exploring.

Published catalogue:
${catalogue}`,
    input: [
      asData("document", knowledge.map((k) => `[${k.title}] ${k.text}`).join("\n---\n") || "(no verified knowledge matched)"),
      ...history.slice(-6).map((t) => (t.role === "user" ? asData("client_message", t.text) : `Assistant said: ${t.text}`)),
      asData("client_message", message),
    ].join("\n\n"),
  });
  if (out.escalate) await flag(db, "assistant requested human follow-up", message);
  const reply = out.reply.startsWith("I'm the MetaMasterMindz AI") || history.length > 0 ? out.reply : `${AI_INTRO} ${out.reply}`;
  return { reply, escalated: out.escalate, link: out.suggestedLink === "none" ? null : out.suggestedLink, mode: "llm" as const };
}

async function flag(db: DB, reason: string, message: string) {
  await db.insert(agentTasks).values({
    id: newId("tsk"),
    agentId: "client-conversation",
    kind: "owner_attention",
    status: "blocked",
    input: { summary: `Website chat: ${reason}`, excerpt: message.slice(0, 280) },
  });
}

/** Deterministic answers when no LLM is configured. */
export function fallbackAnswer(message: string, services: Awaited<ReturnType<typeof listServices>>) {
  const m = message.toLowerCase();
  const match = services.find((s) => m.includes(s.name.toLowerCase()) || s.id.split("-").every((w) => m.includes(w)));
  if (match) {
    return {
      reply: `${AI_INTRO} ${match.name}: ${match.description} Investment: ${formatPriceRange(match.priceMinor, match.priceMaxMinor)}${match.priceUnit === "per_participant" ? " per person" : ""}.${match.ownerApprovedPrice ? "" : " (Pricing is being finalised.)"}`,
      link: match.bookingRules.requiresDiscoveryCall ? "/book?service=discovery-call" : `/book?service=${match.id}`,
    };
  }
  if (/price|cost|how much|fee/.test(m)) {
    return { reply: `${AI_INTRO} Private sessions start from ${formatPriceRange(22200, null)}, and the 20-minute discovery call is complimentary. You can see every option on the sessions page.`, link: "/sessions" };
  }
  if (/book|availab|appointment|when/.test(m)) {
    return { reply: `${AI_INTRO} You can choose a time for a free discovery call online — it's the best first step.`, link: "/book?service=discovery-call" };
  }
  return { reply: `${AI_INTRO} I can help with questions about sessions, programmes, events, pricing and booking. For anything else, the team will reply personally via the contact form.`, link: "/faq" };
}
