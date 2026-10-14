import { NextResponse } from "next/server";
import { assertSameOrigin, db, handle, requireUser } from "@/lib/server";
import { extractText, fetchApprovedUrl, ingestDocument, type SupportedFormat } from "@/lib/knowledge/knowledge";

const MAX_BYTES = 15 * 1024 * 1024;
const EXT: Record<string, SupportedFormat> = { pdf: "pdf", docx: "docx", txt: "txt", md: "md", markdown: "md", csv: "csv", json: "json" };

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const u = await requireUser("knowledge.manage");
    const f = await req.formData();
    const file = f.get("file");
    const url = String(f.get("url") ?? "").trim();
    const pasted = String(f.get("text") ?? "").trim();
    let text: string;
    let format: SupportedFormat;
    let source: string;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (15 MB max)" }, { status: 413 });
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      format = EXT[ext]!;
      if (!format) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
      text = await extractText(format, Buffer.from(await file.arrayBuffer()));
      source = `upload:${file.name}`;
    } else if (url) {
      format = "url";
      text = await extractText("url", await fetchApprovedUrl(url));
      source = url;
    } else if (pasted) {
      format = "txt";
      text = pasted;
      source = `pasted by ${u.email}`;
    } else return NextResponse.json({ error: "Provide a file, approved URL, or text" }, { status: 400 });

    const r = await ingestDocument(
      await db(),
      {
        title: String(f.get("title")),
        section: String(f.get("section")) as never,
        source,
        format,
        owner: u.name,
        accessLevel: String(f.get("accessLevel")) as never,
        verificationStatus: String(f.get("verificationStatus")) as never,
        replacesDocumentId: String(f.get("replacesDocumentId") || "") || undefined,
      },
      text,
      `user:${u.id}`,
    );
    return NextResponse.json(r, { status: 201 });
  });
}
