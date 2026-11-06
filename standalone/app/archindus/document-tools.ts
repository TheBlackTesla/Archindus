import { requestId } from "./request-id";
import { MAX_DOCUMENT_CHARS, MAX_FILE_BYTES, type Attachment } from "./artifacts";

export async function readAttachment(file: File): Promise<Attachment> {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Choose a nonempty file up to 5 MB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  let text = ""; let truncated = false;
  if (["txt", "md", "csv", "json"].includes(extension ?? "")) {
    text = await file.text();
    if (text.includes("\u0000")) throw new Error("This file contains binary data. Upload a text document instead.");
    if (extension === "json") { try { JSON.parse(text); } catch { throw new Error("This JSON file is not valid JSON."); } }
  } else if (extension === "docx") {
    const { unzipSync, strFromU8 } = await import("fflate");
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
      if (entry.name !== "word/document.xml") return false;
      if (entry.originalSize > 2_000_000) throw new Error("The expanded Word document is too large. Use a shorter document.");
      return true;
    } });
    if (!entries["word/document.xml"]) throw new Error("This file is not a readable DOCX document.");
    const xml = new DOMParser().parseFromString(strFromU8(entries["word/document.xml"]), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("The Word document contains invalid XML.");
    text = [...xml.getElementsByTagNameNS("*", "p")].map(p => [...p.getElementsByTagNameNS("*", "t")].map(t => t.textContent ?? "").join("")).join("\n");
  } else if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      truncated = pdf.numPages > 40;
      for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("") + "\n";
        page.cleanup();
        if (text.length > MAX_DOCUMENT_CHARS) { truncated = true; break; }
      }
    } finally { await task.destroy(); }
  } else throw new Error("Supported files: PDF, DOCX, TXT, Markdown, CSV, and JSON.");
  if (!text.trim()) throw new Error("No readable text was found. Scanned PDFs need OCR before upload.");
  return { id: requestId(), name: file.name.slice(0, 120), text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: truncated || text.length > MAX_DOCUMENT_CHARS };
}

export async function exportDocx(text: string): Promise<Blob> {
  const { Document, Paragraph, TextRun, Packer, HeadingLevel } = await import("docx");
  let code = false;
  const children = text.split("\n").flatMap(line => {
    if (/^```/.test(line)) { code = !code; return []; }
    const heading = !code ? /^(#{1,3})\s+(.+)$/.exec(line) : null;
    return [new Paragraph({
      heading: heading ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1].length - 1] : undefined,
      bullet: !code && /^[-*]\s/.test(line) ? { level: 0 } : undefined,
      children: [new TextRun({ text: heading ? heading[2] : line.replace(!code ? /^[-*]\s/ : /$^/, ""), font: code ? "Courier New" : "Calibri", size: code ? 19 : 22 })],
      spacing: { after: code ? 0 : 100 },
    })];
  });
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}

export async function exportPdf(text: string, fontBytes?: ArrayBuffer): Promise<Blob> {
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit")]);
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  if (!fontBytes) { const response = await fetch("/fonts/DejaVuSans.ttf"); if (!response.ok) throw new Error("The PDF font could not be loaded. Try DOCX or Markdown."); fontBytes = await response.arrayBuffer(); }
  const font = await doc.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const missing = [...text].some(c => !/\s/.test(c) && !supported.has(c.codePointAt(0)!));
  if (missing) throw new Error("This PDF font cannot display some characters. Download DOCX or Markdown to preserve the full text.");
  let page = doc.addPage([595.28, 841.89]); let y = 785;
  const draw = (line: string, size: number) => {
    if (y < 56) { page = doc.addPage([595.28, 841.89]); y = 785; }
    page.drawText(line, { x: 50, y, font, size, color: rgb(0.12, 0.14, 0.18) }); y -= size * 1.5;
  };
  for (const paragraph of text.split("\n")) {
    if (/^```/.test(paragraph)) continue;
    const size = /^#{1,3}\s/.test(paragraph) ? 15 : 10.5;
    const value = paragraph.replace(/^#{1,3}\s/, "").replace(/\t/g, "    "); let line = "";
    // Character wrapping also bounds long code lines and URLs without dropping text.
    for (const character of value) {
      if (line && font.widthOfTextAtSize(line + character, size) > 495) { draw(line, size); line = ""; }
      line += character;
    }
    draw(line, size);
  }
  return new Blob([new Uint8Array(await doc.save())], { type: "application/pdf" });
}
