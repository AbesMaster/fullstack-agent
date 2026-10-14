import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { contentItems } from "../db/schema";
import { newId } from "../util";
import { audit } from "../audit/audit";
import { publish } from "../events/bus";
import { checkClaims, isBlocked } from "../compliance/claims";
import { assertTool, requestApproval } from "../agents/controls";

/**
 * Marketing pipeline:
 * research → topic → brief → draft → COMPLIANCE REVIEW → OWNER APPROVAL → media → schedule → publish → analyse
 *
 * Nothing reaches "approved"/"scheduled" without a decided approval. Platforms without an
 * approved publishing API (or without credentials) use the manual "ready to post" export.
 */

export const CONTENT_CATEGORIES = [
  "Felicia's Journey",
  "Star Magic-Inspired Wellness",
  "Mindfulness",
  "Conscious Living",
  "Self-Discovery",
  "Personal Growth",
  "Breathwork Education",
  "Emotional Awareness",
  "Relationship Connection",
  "Healing Adventures",
  "Community Stories",
] as const;

export const CHANNELS = ["instagram", "facebook", "tiktok", "youtube", "email", "landing_page"] as const;

export const DraftSchema = z.object({
  channel: z.enum(CHANNELS),
  category: z.enum(CONTENT_CATEGORIES),
  format: z.enum(["caption", "short_script", "carousel", "email", "landing_copy", "brief"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
});

export async function createDraft(db: DB, agentId: string, input: z.input<typeof DraftSchema>) {
  assertTool(agentId, "content.draft");
  const d = DraftSchema.parse(input);
  const id = newId("cnt");
  await db.insert(contentItems).values({ id, ...d, status: "draft", createdBy: `agent:${agentId}` });
  await audit(db, { actor: `agent:${agentId}`, action: "content.drafted", target: id });
  return id;
}

/** Runs compliance; blocked drafts go back to "rejected" with reasons, clean ones request owner approval. */
export async function submitForApproval(db: DB, contentId: string, requestingAgent = "social-ops") {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, contentId));
  if (!item) throw new Error("Content not found");
  if (!["draft", "rejected"].includes(item.status)) throw new Error(`Content is ${item.status}; only drafts can be submitted`);
  const flags = checkClaims(`${item.title}\n${item.body}`);
  const flagText = flags.map((f) => `${f.severity.toUpperCase()} ${f.rule}: "${f.match}" — ${f.advice}`);
  if (isBlocked(flags)) {
    await db.update(contentItems).set({ status: "rejected", complianceFlags: flagText, updatedAt: new Date() }).where(eq(contentItems.id, contentId));
    await audit(db, { actor: "agent:compliance", action: "content.compliance_blocked", target: contentId, metadata: { rules: flags.map((f) => f.rule) } });
    return { status: "rejected" as const, flags };
  }
  await db.update(contentItems).set({ status: "awaiting_approval", complianceFlags: flagText, updatedAt: new Date() }).where(eq(contentItems.id, contentId));
  const action = item.channel === "email" ? "email.send_marketing" : "content.publish";
  const agent = action === "email.send_marketing" ? "email-marketing" : requestingAgent;
  const approvalId = await requestApproval(db, agent, action, `Publish ${item.channel} ${item.format}: "${item.title}"${flags.length ? ` (${flags.length} item(s) to review)` : ""}`, { contentId });
  await publish(db, "CONTENT_SUBMITTED", { contentId }, { correlationId: newId("cor"), idempotencyKey: `${contentId}:v${item.version}` });
  return { status: "awaiting_approval" as const, flags, approvalId };
}

/** Manual publishing export for platforms without an approved API integration. */
export function manualPostingPack(item: typeof contentItems.$inferSelect) {
  return {
    platform: item.channel,
    title: item.title,
    copy: item.body,
    instructions: `Approved content. Post manually on ${item.channel}, then mark as published in the Command Center so performance can be tracked.`,
  };
}
