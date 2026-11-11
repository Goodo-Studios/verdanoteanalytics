// The browser side of the public-apply function: the creator and actor application forms.
// No login. A draft id from `begin` is the only thing the later calls need.
import { supabase } from "@/integrations/supabase/client";
import { failureFromStatus, type LinkFailure } from "./publicLinkApi";

export type ApplyKind = "creator" | "actor";
export type ApplyResult<T> = { ok: true; data: T } | { ok: false; reason: LinkFailure | "too_many_files" | "bad_type"; field?: string };

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-apply`;

/** The hidden field name. People never see it; a bot that fills every field fills it. */
export const HONEYPOT_FIELD = "company_website";

export const LIMITS = {
  headshotBytes: 5 * 1024 * 1024,
  videoBytes: 250 * 1024 * 1024,
  videos: { creator: { min: 3, max: 8 }, actor: { min: 1, max: 8 } },
  headshotTypes: ["image/jpeg", "image/png", "image/webp"],
  videoTypes: ["video/mp4", "video/quicktime", "video/webm"],
} as const;

export async function callApply<T>(body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<ApplyResult<T>> {
  try {
    const res = await fetchImpl(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify(body),
    });
    let json: { error?: string; field?: string } | null = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, data: json as T };
    if (json?.error === "too_many_files") return { ok: false, reason: "too_many_files" };
    if (json?.error === "bad_type") return { ok: false, reason: "bad_type" };
    return { ok: false, reason: failureFromStatus(res.status, json?.error), field: json?.field };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** The plain sentence for a file that cannot be used, or null when it is fine. */
export function checkFile(file: { type: string; size: number }, fileKind: "headshot" | "video"): string | null {
  const types: readonly string[] = fileKind === "headshot" ? LIMITS.headshotTypes : LIMITS.videoTypes;
  const max = fileKind === "headshot" ? LIMITS.headshotBytes : LIMITS.videoBytes;
  if (!types.includes(file.type)) return fileKind === "headshot" ? "Please use a JPG, PNG or WebP photo." : "Please use an MP4, MOV or WebM video.";
  if (file.size > max) return fileKind === "headshot" ? "That photo is over 5 MB. Please use a smaller one." : "That video is over 250 MB. Please use a smaller one.";
  if (file.size < 1) return "That file is empty.";
  return null;
}

export interface UploadedFile {
  path: string;
  name: string;
  size: number;
  mime: string;
}

/** Asks for a signed address inside this draft's folder, then sends the file to it. */
export async function uploadFile(kind: ApplyKind, draftId: string, fileKind: "headshot" | "video", file: File): Promise<ApplyResult<UploadedFile>> {
  const ticket = await callApply<{ path: string; bucket: string; token: string | null }>({
    kind, action: "upload_url", draft_id: draftId, file_kind: fileKind, size: file.size, mime: file.type,
  });
  if (!ticket.ok) return ticket;
  if (!ticket.data.token) return { ok: false, reason: "error" };
  const { error } = await supabase.storage.from(ticket.data.bucket).uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
  if (error) return { ok: false, reason: "error" };
  return { ok: true, data: { path: ticket.data.path, name: file.name, size: file.size, mime: file.type } };
}
