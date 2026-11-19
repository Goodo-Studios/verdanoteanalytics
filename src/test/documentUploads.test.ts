/**
 * Document uploads shared by Knowledge, the Brain and client BIDs (src/features/documents).
 *
 * - File rules: allowed types, 10 MB limit, empty file, safe storage names, titles from the file.
 * - Reading: markdown and text as they are, a Word file without a library, a PDF left unread.
 * - The upload flow: validation errors come back as plain text before anything is sent; the original
 *   file is stored first and the checked database function is called with its path; a refused call
 *   removes the stored file; database error codes become plain text.
 * The database rules are in supabase/tests/staff_document_uploads_test.sql.
 */
import { deflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  uploads: [] as Array<{ path: string; contentType: string }>,
  removed: [] as string[][],
  uploadError: null as null | { message: string },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (path: string, _file: unknown, opts: { contentType: string }) => {
          h.uploads.push({ path, contentType: opts.contentType });
          return Promise.resolve({ error: h.uploadError });
        },
        remove: (paths: string[]) => {
          h.removed.push(paths);
          return Promise.resolve({ error: null });
        },
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://example.test/signed" }, error: null }),
      }),
    },
  },
}));

import {
  docxToMarkdown,
  extractDocumentText,
  kindOfFile,
  MAX_DOCUMENT_BYTES,
  pdfPlaceholder,
  safeFileName,
  storagePath,
  titleFromDocument,
  uploadErrorText,
  validateDocumentFile,
  wordXmlToMarkdown,
} from "@/features/documents/model";
import { submitDocument } from "@/features/documents/upload";

const file = (name: string, body: string, type = "") => new File([body], name, { type });

/** A minimal .docx: one zip entry, word/document.xml, deflated. */
function makeDocx(xml: string, method: 0 | 8 = 8): Uint8Array {
  const name = new TextEncoder().encode("word/document.xml");
  const raw = new TextEncoder().encode(xml);
  const data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
  const local = new Uint8Array(30 + name.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, method, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, raw.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(data, 30 + name.length);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, method, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, raw.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

const DOC_XML =
  '<w:document><w:body>' +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Launch plan</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Hooks &amp; </w:t></w:r><w:r><w:t>offers</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>First step</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Second step</w:t></w:r></w:p>' +
  '<w:p></w:p></w:body></w:document>';

describe("file rules", () => {
  it("accepts markdown, text, PDF and Word by extension and nothing else", () => {
    expect(["a.md", "a.MARKDOWN", "a.txt", "a.pdf", "a.docx"].map(kindOfFile)).toEqual(["markdown", "markdown", "text", "pdf", "docx"]);
    expect(kindOfFile("a.exe")).toBeNull();
    expect(kindOfFile("a.doc")).toBeNull();
    expect(kindOfFile("noextension")).toBeNull();
  });

  it("refuses a wrong type, an empty file and a file over 10 MB with plain text", () => {
    expect(validateDocumentFile({ name: "a.md", size: 10 })).toBeNull();
    expect(validateDocumentFile({ name: "a.md", size: MAX_DOCUMENT_BYTES })).toBeNull();
    expect(validateDocumentFile({ name: "a.md", size: MAX_DOCUMENT_BYTES + 1 })).toBe("That file is over 10 MB. Use a smaller file.");
    expect(validateDocumentFile({ name: "a.md", size: 0 })).toBe("That file is empty.");
    expect(validateDocumentFile({ name: "a.zip", size: 5 })).toMatch(/not supported/);
  });

  it("builds safe storage paths and readable titles", () => {
    expect(safeFileName("My Playbook (final) v2.md")).toBe("My-Playbook-final-v2.md");
    expect(safeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFileName("???")).toBe("document");
    expect(storagePath("brain", "abc", "A B.md")).toBe("brain/abc/A-B.md");
    expect(titleFromDocument("launch-playbook.md", "intro\n\n# The Real Title\n\nText")).toBe("The Real Title");
    expect(titleFromDocument("launch-playbook.md", "no heading here")).toBe("launch playbook");
    expect(titleFromDocument(null, "", "Brand doc")).toBe("Brand doc");
  });
});

describe("reading files", () => {
  it("reads markdown and text as they are and drops a byte order mark", async () => {
    expect(await extractDocumentText(file("a.md", "# Hi\n\nText"))).toEqual({ text: "# Hi\n\nText", kind: "markdown" });
    expect((await extractDocumentText(file("a.txt", "﻿plain"))).text).toBe("plain");
  });

  it("leaves a PDF unread but keeps its kind", async () => {
    expect(await extractDocumentText(file("a.pdf", "%PDF-1.4"))).toEqual({ text: "", kind: "pdf" });
  });

  it("reads the text of a Word file: headings, bullets, entities, no empty paragraphs", async () => {
    const expected = "# Launch plan\n\nHooks & offers\n\n- First step\n- Second step";
    expect(wordXmlToMarkdown(DOC_XML)).toBe(expected);
    expect(await docxToMarkdown(makeDocx(DOC_XML))).toBe(expected);
    expect(await docxToMarkdown(makeDocx(DOC_XML, 0))).toBe(expected);
  });

  it("says plainly when a Word file cannot be read", async () => {
    await expect(docxToMarkdown(new TextEncoder().encode("not a zip"))).rejects.toThrow();
    await expect(extractDocumentText(file("broken.docx", "not a zip"))).rejects.toThrow(/could not be read/);
  });
});

describe("submitDocument", () => {
  beforeEach(() => {
    h.uploads.length = 0;
    h.removed.length = 0;
    h.uploadError = null;
  });
  const ok = (data = "id-1") => vi.fn().mockResolvedValue({ data, error: null });

  it("pasted text alone calls the function with the text and no file", async () => {
    const call = ok();
    const r = await submitDocument({ area: "knowledge", file: null, pastedText: "  Some text  ", call, failureText: "x" });
    expect(r).toMatchObject({ ok: true, data: "id-1", storedFile: null });
    expect(call).toHaveBeenCalledWith("Some text", null);
    expect(h.uploads).toHaveLength(0);
  });

  it("stores the original file in the area's folder with its type, then passes the path on", async () => {
    const call = ok();
    const r = await submitDocument({ area: "brain", file: file("My Playbook.md", "# Playbook\n\nStep."), pastedText: "", call, failureText: "x" });
    expect(r.ok).toBe(true);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].path).toMatch(/^brain\/[0-9a-f-]{36}\/My-Playbook\.md$/);
    expect(h.uploads[0].contentType).toBe("text/markdown");
    expect(call).toHaveBeenCalledWith("# Playbook\n\nStep.", { path: h.uploads[0].path, name: "My Playbook.md", mime: "text/markdown", size: 17 });
  });

  it("stores a PDF and uses the pasted text, or a short note when none is given", async () => {
    const withText = ok();
    await submitDocument({ area: "bid", file: file("brand.pdf", "%PDF"), pastedText: "Pasted summary", call: withText, failureText: "x" });
    expect(withText.mock.calls[0][0]).toBe("Pasted summary");
    expect(h.uploads[0].contentType).toBe("application/pdf");
    const without = ok();
    await submitDocument({ area: "bid", file: file("brand.pdf", "%PDF"), pastedText: "", call: without, failureText: "x" });
    expect(without.mock.calls[0][0]).toBe(pdfPlaceholder("brand.pdf"));
  });

  it("refuses a bad file or no input before anything is stored or sent", async () => {
    const call = ok();
    expect(await submitDocument({ area: "bid", file: file("a.exe", "x"), pastedText: "", call, failureText: "x" })).toEqual({ ok: false, message: expect.stringMatching(/not supported/) });
    expect(await submitDocument({ area: "bid", file: null, pastedText: "   ", call, failureText: "x" })).toEqual({ ok: false, message: "Choose a file or paste some text." });
    expect(await submitDocument({ area: "bid", file: file("blank.md", "   \n"), pastedText: "", call, failureText: "x" })).toEqual({ ok: false, message: "That file has no text in it." });
    const big = new File([new Uint8Array(1)], "big.md");
    Object.defineProperty(big, "size", { value: MAX_DOCUMENT_BYTES + 1 });
    expect(await submitDocument({ area: "bid", file: big, pastedText: "", call, failureText: "x" })).toEqual({ ok: false, message: "That file is over 10 MB. Use a smaller file." });
    expect(call).not.toHaveBeenCalled();
    expect(h.uploads).toHaveLength(0);
  });

  it("reports a storage failure and does not call the function", async () => {
    h.uploadError = { message: "denied" };
    const call = ok();
    const r = await submitDocument({ area: "brain", file: file("a.md", "text"), pastedText: "", call, failureText: "x" });
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/could not be uploaded/) });
    expect(call).not.toHaveBeenCalled();
  });

  it("removes the stored file when the database function refuses, and shows plain text", async () => {
    const call = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "insufficient_privilege" } });
    const r = await submitDocument({ area: "knowledge", file: file("a.md", "text"), pastedText: "", call, failureText: "x" });
    expect(r).toEqual({ ok: false, message: "You are not allowed to do that here." });
    expect(h.removed).toEqual([[h.uploads[0].path]]);
  });
});

describe("uploadErrorText", () => {
  it("turns database codes into plain text and keeps the fallback otherwise", () => {
    expect(uploadErrorText("22023", "f")).toMatch(/Markdown, text, PDF or Word up to 10 MB/);
    expect(uploadErrorText("23514", "f")).toMatch(/200,000 characters/);
    expect(uploadErrorText("P0002", "f")).toBe("That client was not found.");
    expect(uploadErrorText("XX000", "fallback")).toBe("fallback");
    expect(uploadErrorText(undefined, "fallback")).toBe("fallback");
  });
});
