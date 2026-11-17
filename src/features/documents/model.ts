// Document uploads shared by Knowledge, the Brain and the client Brand doc (BID).
//
// Staff pick a file or paste text. The text goes to the table for that area through a checked
// database function; the original file goes to the private staff-documents bucket (migration
// 20261216570001). Markdown, text and Word (.docx) files are read in the browser so their text is
// shown in the app. A PDF is stored as the original file only: its text is not read yet, so the
// person can paste the text next to it, and the original opens from the document page.

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_BUCKET = "staff-documents";
export type DocumentArea = "bid" | "knowledge" | "brain";
export type DocumentKind = "markdown" | "text" | "pdf" | "docx";

export const KIND_MIME: Record<DocumentKind, string> = {
  markdown: "text/markdown",
  text: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const ACCEPT_ATTRIBUTE = ".md,.markdown,.txt,.pdf,.docx";
export const TYPES_HINT = "Markdown, text, PDF or Word (.docx), up to 10 MB.";

export function kindOfFile(name: string): DocumentKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  switch (ext) {
    case "md":
    case "markdown":
      return "markdown";
    case "txt":
      return "text";
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    default:
      return null;
  }
}

/** A plain-language reason the file cannot be used, or null when it can. */
export function validateDocumentFile(file: { name: string; size: number }): string | null {
  if (!kindOfFile(file.name)) return "That file type is not supported. Use a Markdown, text, PDF or Word (.docx) file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return "That file is over 10 MB. Use a smaller file.";
  return null;
}

/** File name safe for a storage path: letters, digits, dot, dash and underscore only. */
export function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(-120);
  return cleaned || "document";
}

export function storagePath(area: DocumentArea, id: string, name: string): string {
  return `${area}/${id}/${safeFileName(name)}`;
}

/** First "# Heading" of a markdown text, else the file name without its extension, else the fallback. */
export function titleFromDocument(fileName: string | null, text: string, fallback = "Untitled document"): string {
  const heading = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(text)?.[1]?.trim();
  if (heading) return heading.slice(0, 200);
  const base = (fileName ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  return (base || fallback).slice(0, 200);
}

export function pdfPlaceholder(fileName: string): string {
  return `This document was uploaded as a PDF (${fileName}). Its text is not shown here. Open the original file from this page.`;
}

// ------------------------------------------------------------------ reading files

function readAsText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

function readAsBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return XML_ENTITIES[e.toLowerCase()] ?? "";
  });

/** Plain markdown from the XML of a Word document body. Headings and bullets are kept; styling is dropped. */
export function wordXmlToMarkdown(xml: string): string {
  const paragraphs = xml.split(/<w:p[ >]/).slice(1);
  let out = "";
  let lastWasBullet = false;
  for (const p of paragraphs) {
    const heading = /<w:pStyle w:val="Heading(\d)"/.exec(p)?.[1];
    const bullet = /<w:numPr>/.test(p);
    let text = "";
    for (const m of p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      text += m[1] !== undefined ? decodeEntities(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n";
    }
    text = text.trim();
    if (!text) continue;
    const line = heading ? `${"#".repeat(Math.min(6, Number(heading)))} ${text}` : bullet ? `- ${text}` : text;
    const isBullet = !heading && bullet;
    out += out ? (isBullet && lastWasBullet ? "\n" : "\n\n") + line : line;
    lastWasBullet = isBullet;
  }
  return out;
}

/** Reads the text of a .docx (a zip file) without a library. Throws when it is not a readable Word file. */
export async function docxToMarkdown(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const entries = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (name === "word/document.xml") {
      const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
      const data = bytes.subarray(dataAt, dataAt + compressed);
      let raw: Uint8Array;
      if (method === 0) raw = data;
      else if (method === 8) {
        const source = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          },
        });
        const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
        raw = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error("unsupported zip method");
      return wordXmlToMarkdown(decoder.decode(raw));
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("no document text");
}

export interface ExtractedText {
  /** The text to store, or "" when the file's text is not read (a PDF). */
  text: string;
  kind: DocumentKind;
}

/** Reads the text of an allowed file. Throws a plain-language Error when it cannot be read. */
export async function extractDocumentText(file: File): Promise<ExtractedText> {
  const kind = kindOfFile(file.name);
  if (!kind) throw new Error("That file type is not supported. Use a Markdown, text, PDF or Word (.docx) file.");
  if (kind === "pdf") return { text: "", kind };
  try {
    if (kind === "docx") return { text: await docxToMarkdown(await readAsBuffer(file)), kind };
    return { text: (await readAsText(file)).replace(/^﻿/, ""), kind };
  } catch {
    throw new Error("That file could not be read. Check that it opens on your computer, or paste the text instead.");
  }
}

// ------------------------------------------------------------------ database errors

/** Plain-language message for an error code from the upload functions. */
export function uploadErrorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "42501":
      return "You are not allowed to do that here.";
    case "22023":
      return "Check the fields and the file: the title and text cannot be empty, and the file must be Markdown, text, PDF or Word up to 10 MB.";
    case "23514":
      return "Check the fields: the title and text cannot be empty, and the text is limited to 200,000 characters.";
    case "P0002":
      return "That client was not found.";
    default:
      return fallback;
  }
}
