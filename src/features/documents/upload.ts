// Shared upload flow: check the file, read its text, store the original in the private bucket, then
// call the area's checked database function. If the function refuses, the stored file is removed so
// no orphan is left behind.
import { supabase } from "@/integrations/supabase/client";
import {
  DOCUMENT_BUCKET,
  type DocumentArea,
  extractDocumentText,
  KIND_MIME,
  kindOfFile,
  pdfPlaceholder,
  storagePath,
  uploadErrorText,
  validateDocumentFile,
} from "./model";

export interface StoredFile {
  path: string;
  name: string;
  mime: string;
  size: number;
}

export interface DbCallResult<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

export type SubmitResult<T> = { ok: true; data: T; storedFile: StoredFile | null } | { ok: false; message: string };

export interface SubmitOptions<T> {
  area: DocumentArea;
  file: File | null;
  /** Text typed or pasted. Used when there is no file, or for a PDF whose text is not read. */
  pastedText: string;
  /** Calls the database function. Gets the text to store and the stored file (or null). */
  call: (body: string, stored: StoredFile | null) => PromiseLike<DbCallResult<T>>;
  failureText: string;
}

export async function submitDocument<T>(opts: SubmitOptions<T>): Promise<SubmitResult<T>> {
  const { area, file, pastedText } = opts;
  if (file) {
    const problem = validateDocumentFile(file);
    if (problem) return { ok: false, message: problem };
  }
  let body = pastedText.trim();
  if (file) {
    try {
      const extracted = await extractDocumentText(file);
      if (extracted.kind === "pdf") body = body || pdfPlaceholder(file.name);
      else body = extracted.text.trim();
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "That file could not be read." };
    }
  }
  if (!body) return { ok: false, message: file ? "That file has no text in it." : "Choose a file or paste some text." };

  let stored: StoredFile | null = null;
  if (file) {
    const kind = kindOfFile(file.name)!;
    const path = storagePath(area, crypto.randomUUID(), file.name);
    const { error } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, { contentType: KIND_MIME[kind], upsert: false });
    if (error) return { ok: false, message: "The file could not be uploaded. Try again, or paste the text instead." };
    stored = { path, name: file.name, mime: KIND_MIME[kind], size: file.size };
  }

  const { data, error } = await opts.call(body, stored);
  if (error || data === null) {
    if (stored) void supabase.storage.from(DOCUMENT_BUCKET).remove([stored.path]);
    return { ok: false, message: uploadErrorText(error?.code, opts.failureText) };
  }
  return { ok: true, data, storedFile: stored };
}

/** One-minute link to the stored original of a document, or null when it cannot be made. */
export async function originalFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 60);
  return error || !data?.signedUrl ? null : data.signedUrl;
}
