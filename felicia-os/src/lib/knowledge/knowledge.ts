import { z } from "zod";
import { eq, sql, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { EMBEDDING_DIM, knowledgeChunks, knowledgeDocuments } from "../db/schema";
import { audit } from "../audit/audit";
import { publicUrl } from "../config/env";
import { newId, sha256 } from "../util";

/**
 * Central business knowledge base (sections A–Q of the directive).
 * Every document carries source, owner, version, access level and verification status;
 * retrieval can be restricted to VERIFIED facts for client-facing answers.
 *
 * Embeddings: a deterministic local feature-hashing embedder is the default so the
 * system works offline and in tests. It is lexical, not semantic. Swap in a hosted
 * embedding model (e.g. Voyage AI) by implementing `Embedder` — the pgvector schema is unchanged.
 */

export const KNOWLEDGE_SECTIONS = {
  A: "Business identity",
  B: "Mission and vision",
  C: "Founder biography",
  D: "Professional credentials",
  E: "Brand messaging",
  F: "Service catalogue",
  G: "Pricing",
  H: "Client experience standards",
  I: "Marketing strategy",
  J: "Sales procedures",
  K: "Financial projections",
  L: "Operational policies",
  M: "Customer support procedures",
  N: "Event management",
  O: "Growth strategy",
  P: "Legal and regulatory requirements",
  Q: "International expansion planning",
} as const;
export type SectionKey = keyof typeof KNOWLEDGE_SECTIONS;

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

const STOP = new Set("a an and are as at be by for from has have i in is it its of on or that the this to was were will with you your we our".split(" "));
const tokens = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const hashingEmbedder: Embedder = {
  name: "local-feature-hashing-v1",
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array<number>(EMBEDDING_DIM).fill(0);
      const toks = tokens(t);
      const feats = [...toks, ...toks.slice(1).map((w, i) => `${toks[i]}_${w}`)];
      for (const f of feats) {
        const h = fnv1a(f);
        v[h % EMBEDDING_DIM]! += h & 0x80000000 ? -1 : 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  },
};

/** Paragraph-aware chunking with overlap. */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const paras = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > maxChars && cur) {
      chunks.push(cur);
      cur = cur.slice(-overlap) + "\n\n" + p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
    while (cur.length > maxChars * 1.5) {
      chunks.push(cur.slice(0, maxChars));
      cur = cur.slice(maxChars - overlap);
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/* ---------------- Format extraction ---------------- */

export type SupportedFormat = "pdf" | "docx" | "txt" | "md" | "csv" | "json" | "url";

export async function extractText(format: SupportedFormat, data: Buffer | string): Promise<string> {
  switch (format) {
    case "txt":
    case "md":
      return data.toString();
    case "csv":
      return data
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((row, i, rows) => (i === 0 ? `Columns: ${row}` : `Row ${i}: ${row}`) + (i === rows.length - 1 ? "" : ""))
        .join("\n");
    case "json":
      return JSON.stringify(JSON.parse(data.toString()), null, 2);
    case "docx": {
      const mammoth = await import("mammoth");
      return (await mammoth.extractRawText({ buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) })).value;
    }
    case "pdf": {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(Buffer.isBuffer(data) ? data : Buffer.from(data)));
      const { text } = await pdfText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join("\n\n") : text;
    }
    case "url":
      return htmlToText(data.toString());
  }
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|section|article|br)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Only URLs on the site's own address may be ingested (SSRF guard + "approved sources" rule). */
export function approvedUrlHosts() {
  const host = new URL(publicUrl()).hostname.replace(/^www\./, "");
  return [host, `www.${host}`];
}

export async function fetchApprovedUrl(url: string, fetchImpl: typeof fetch = fetch) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !approvedUrlHosts().includes(u.hostname)) throw new Error(`URL host not approved for ingestion: ${u.hostname}`);
  const res = await fetchImpl(u, { redirect: "error" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.text();
}

/* ---------------- Ingestion ---------------- */

export const IngestSchema = z.object({
  title: z.string().min(1).max(200),
  section: z.enum(Object.keys(KNOWLEDGE_SECTIONS) as [SectionKey, ...SectionKey[]]),
  source: z.string().min(1).max(500),
  format: z.enum(["pdf", "docx", "txt", "md", "csv", "json", "url"]),
  owner: z.string().min(1).max(120),
  accessLevel: z.enum(["public", "internal", "restricted"]).default("internal"),
  verificationStatus: z.enum(["verified", "assumption", "draft"]).default("draft"),
  replacesDocumentId: z.string().optional(),
});

export async function ingestDocument(db: DB, meta: z.input<typeof IngestSchema>, text: string, actor: string, embedder: Embedder = hashingEmbedder) {
  const m = IngestSchema.parse(meta);
  const clean = text.trim();
  if (!clean) throw new Error("Document contains no extractable text");
  const contentHash = sha256(clean);

  let id = newId("doc");
  let version = 1;
  if (m.replacesDocumentId) {
    const [prev] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, m.replacesDocumentId));
    if (!prev) throw new Error("Document to replace not found");
    if (prev.contentHash === contentHash) return { documentId: prev.id, version: prev.version, unchanged: true };
    id = prev.id;
    version = prev.version + 1;
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, id));
    await db
      .update(knowledgeDocuments)
      .set({ title: m.title, section: m.section, source: m.source, format: m.format, owner: m.owner, accessLevel: m.accessLevel, verificationStatus: m.verificationStatus, contentHash, version, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id));
  } else {
    await db.insert(knowledgeDocuments).values({ id, title: m.title, section: m.section, source: m.source, format: m.format, owner: m.owner, accessLevel: m.accessLevel, verificationStatus: m.verificationStatus, contentHash });
  }

  const chunks = chunkText(clean);
  const vectors = await embedder.embed(chunks);
  if (chunks.length) {
    await db.insert(knowledgeChunks).values(chunks.map((t, idx) => ({ id: newId("chk"), documentId: id, idx, text: t, embedding: vectors[idx]! })));
  }
  await audit(db, { actor, action: m.replacesDocumentId ? "knowledge.updated" : "knowledge.ingested", target: id, metadata: { title: m.title, version, chunks: chunks.length } });
  return { documentId: id, version, unchanged: false, chunks: chunks.length };
}

export type RetrievedChunk = { documentId: string; title: string; section: string; verificationStatus: string; text: string; score: number };

/**
 * Vector search. `audience: "public"` (client-facing agents) only sees public, VERIFIED docs;
 * internal agents see public+internal; restricted needs an explicit grant.
 */
export async function retrieve(
  db: DB,
  query: string,
  opts: { k?: number; audience: "public" | "internal" | "restricted"; verifiedOnly?: boolean },
  embedder: Embedder = hashingEmbedder,
): Promise<RetrievedChunk[]> {
  const [qv] = await embedder.embed([query]);
  const levels = opts.audience === "public" ? ["public"] : opts.audience === "internal" ? ["public", "internal"] : ["public", "internal", "restricted"];
  const statuses = opts.verifiedOnly || opts.audience === "public" ? ["verified"] : ["verified", "assumption", "draft"];
  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .where(sql`${inArray(knowledgeDocuments.accessLevel, levels)} and ${inArray(knowledgeDocuments.verificationStatus, statuses as ("verified" | "assumption" | "draft")[])}`);
  if (!docs.length) return [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  const vec = `[${qv!.join(",")}]`;
  const rows = await db
    .select({ documentId: knowledgeChunks.documentId, text: knowledgeChunks.text, distance: sql<number>`${knowledgeChunks.embedding} <=> ${vec}::vector` })
    .from(knowledgeChunks)
    .where(inArray(knowledgeChunks.documentId, [...byId.keys()]))
    .orderBy(sql`${knowledgeChunks.embedding} <=> ${vec}::vector`)
    .limit(opts.k ?? 5);
  return rows.map((r) => {
    const d = byId.get(r.documentId)!;
    return { documentId: r.documentId, title: d.title, section: d.section, verificationStatus: d.verificationStatus, text: r.text, score: 1 - Number(r.distance) };
  });
}
