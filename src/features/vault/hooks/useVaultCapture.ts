// useVaultCapture — the single capture path into the global Creative Vault.
//
// Every surface that saves inspiration goes through this module: the desktop
// CaptureModal (paste-URL tab + upload tab) and the mobile entry points added by
// vault-mobile-capture (the Android share-target route and the iPhone quick-add
// page). Nothing here re-implements scraping, analysis, or persistence — both
// paths call the SAME session-authed `vault-save` edge function the modal has
// always called, which in turn kicks off vault-extract (URL) or the image-only
// branch of vault-analyze (static upload).
//
// Hard policy — verdanote-in-app-ui-uses-session-authed-edge-function-not-api:
// in-app UI authenticates with the caller's Supabase session JWT against the
// first-party edge functions. It must NEVER call the API-key-gated `api`
// function.
//
// Role gating lives HERE, not in the UI, so a client-role account is rejected
// no matter which surface it comes from. The server still owns the real
// boundary (RLS + edge-function auth); this is the shared client-side gate that
// keeps every surface consistent and gives a plain-language message.
import { useCallback, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type VaultCaptureRole = "builder" | "employee" | "client";

/** Why a capture could not be completed. */
export type VaultCaptureFailureReason =
  /** No active Supabase session — the caller should redirect to login. */
  | "unauthenticated"
  /** Signed in, but the role may not capture (client accounts). */
  | "forbidden"
  /** The URL or file the caller handed us cannot be captured. */
  | "invalid-input"
  /** Upload / edge-function / network failure. */
  | "failed";

/** Message shown to a client-role account on any capture surface. */
export const CLIENT_ROLE_MESSAGE =
  "Saving to the Vault is not available for your account.";

/** A capture failure carrying a machine-readable reason for the caller. */
export class VaultCaptureError extends Error {
  readonly reason: VaultCaptureFailureReason;

  constructor(reason: VaultCaptureFailureReason, message: string) {
    super(message);
    this.name = "VaultCaptureError";
    this.reason = reason;
  }
}

/**
 * True when the failure means "there is no session" — the signal for a capture
 * surface to redirect to login. Preserving the pending capture across the login
 * round-trip is deliberately out of scope: the user re-shares or re-pastes.
 */
export function isLoginRequired(err: unknown): boolean {
  return err instanceof VaultCaptureError && err.reason === "unauthenticated";
}

/** True when the signed-in account's role may not capture. */
export function isCaptureForbidden(err: unknown): boolean {
  return err instanceof VaultCaptureError && err.reason === "forbidden";
}

/** Optional metadata a surface can attach to the captured item. */
export interface VaultCaptureMetadata {
  /** Brand override — left blank, the AI pipeline detects it. */
  brandName?: string | null;
  /** Lowercased tag list written to inspiration_tags. */
  tags?: string[];
  /** Free-text note stored on the item. */
  notes?: string | null;
}

/** What the caller wants captured: a link or a media file. */
export type VaultCaptureInput =
  | { type: "url"; url: string }
  | { type: "file"; file: File };

export interface VaultCaptureOptions {
  /**
   * Skip the role lookup when the caller already knows the role (e.g. from
   * AuthContext). Omit it and the service resolves the role itself — which is
   * what makes the gate hold for non-React callers too.
   */
  role?: VaultCaptureRole | null;
}

export interface VaultCaptureResult {
  /** The inspiration_items row id created by vault-save. */
  itemId: string;
}

/**
 * Call a first-party edge function with the caller's session JWT.
 *
 * This is the exact request shape CaptureModal has always used (raw fetch
 * against /functions/v1/<name> with a Bearer access token), kept verbatim so the
 * mobile surfaces hit an identical, already-proven code path.
 */
export async function callVaultFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> & { item_id?: string }> {
  const session = await requireSession();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new VaultCaptureError("failed", (data?.error as string) ?? "Request failed");
  }
  return data;
}

/** Resolve the active session, or signal that the caller must log in. */
async function requireSession(): Promise<Session> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new VaultCaptureError("unauthenticated", "Not authenticated");
  }
  return session;
}

/** Look up the signed-in user's app role. */
export async function fetchVaultCaptureRole(
  userId: string,
): Promise<VaultCaptureRole | null> {
  const { data, error } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (error) {
    throw new VaultCaptureError("failed", error.message || "Could not verify your account");
  }
  return (data as VaultCaptureRole) ?? null;
}

/**
 * Resolve the session and enforce the role gate. Returns the session so callers
 * can use `session.user.id` for storage paths without a second round-trip.
 */
async function authorizeCapture(options?: VaultCaptureOptions): Promise<Session> {
  const session = await requireSession();
  const role =
    options?.role !== undefined && options.role !== null
      ? options.role
      : await fetchVaultCaptureRole(session.user.id);

  // Only `client` is refused. An unresolved role is left to the server-side
  // checks rather than locking out a legitimate builder/employee on an RPC hiccup.
  if (role === "client") {
    throw new VaultCaptureError("forbidden", CLIENT_ROLE_MESSAGE);
  }
  return session;
}

/** Validate and normalize a pasted / shared link. */
export function normalizeCaptureUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw new VaultCaptureError("invalid-input", "Paste a link to save.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new VaultCaptureError("invalid-input", "That does not look like a valid link.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new VaultCaptureError("invalid-input", "That does not look like a valid link.");
  }
  return trimmed;
}

/** Only video and image media can be captured. */
export function isSupportedCaptureFile(file: File | null | undefined): boolean {
  const type = file?.type ?? "";
  return type.startsWith("video/") || type.startsWith("image/");
}

/**
 * Grab a poster frame from an uploaded video so the library card has a
 * thumbnail before the analysis pipeline finishes. Resolves null (never
 * rejects) when the browser cannot decode the file — a missing thumbnail must
 * not fail the capture.
 */
export function generateVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.muted = true;
    video.preload = "metadata";

    const cleanup = () => URL.revokeObjectURL(objectUrl);
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10_000);

    video.addEventListener(
      "loadeddata",
      () => {
        video.currentTime = Math.min(1, video.duration * 0.1);
      },
      { once: true },
    );

    video.addEventListener(
      "seeked",
      () => {
        clearTimeout(timeout);
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 568;
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            resolve(blob);
          },
          "image/jpeg",
          0.8,
        );
      },
      { once: true },
    );

    video.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        cleanup();
        resolve(null);
      },
      { once: true },
    );
  });
}

/**
 * Attach optional tags / notes to a freshly created item. Best-effort: the item
 * already exists, so a tag write failure is logged rather than surfaced as a
 * capture failure (this mirrors the pre-refactor CaptureModal behavior).
 */
export async function attachTagsAndNotes(
  itemId: string,
  metadata?: VaultCaptureMetadata,
): Promise<void> {
  const parsedTags = (metadata?.tags ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const notes = (metadata?.notes ?? "").trim();

  if (parsedTags.length === 0 && !notes) return;

  if (parsedTags.length > 0) {
    const { error } = await supabase
      .from("inspiration_tags")
      .upsert(parsedTags.map((tag) => ({ item_id: itemId, tag })), {
        onConflict: "item_id,tag",
      });
    if (error) console.error("Tag insert failed:", error);
  }

  if (notes) {
    await supabase.from("inspiration_items").update({ ad_body_text: notes }).eq("id", itemId);
  }
}

/**
 * Capture a link. Identical to CaptureModal's paste-URL tab: one `vault-save`
 * call with `{ url, brand_name }`, which creates the inspiration_items row and
 * kicks off vault-extract.
 */
export async function captureUrlToVault(
  rawUrl: string,
  metadata?: VaultCaptureMetadata,
  options?: VaultCaptureOptions,
): Promise<VaultCaptureResult> {
  const url = normalizeCaptureUrl(rawUrl);
  await authorizeCapture(options);

  const result = await callVaultFunction("vault-save", {
    url,
    brand_name: metadata?.brandName?.trim() || null,
  });
  const itemId = result.item_id as string;
  await attachTagsAndNotes(itemId, metadata);
  return { itemId };
}

/**
 * Capture a media file. Identical to CaptureModal's upload tab: upload to the
 * `inspiration-media` bucket, generate a poster frame for video, then one
 * `vault-save` call with `{ file_path, platform: "upload", mime_type }`. A
 * static image lands on vault-analyze's image-only branch server-side.
 */
export async function captureFileToVault(
  file: File,
  metadata?: VaultCaptureMetadata,
  options?: VaultCaptureOptions,
): Promise<VaultCaptureResult> {
  if (!isSupportedCaptureFile(file)) {
    throw new VaultCaptureError(
      "invalid-input",
      "Only video and image files are supported",
    );
  }
  const session = await authorizeCapture(options);

  const ext = file.name.split(".").pop();
  const ts = Date.now();
  const path = `uploads/${session.user.id}/${ts}.${ext}`;

  const isVideo = file.type.startsWith("video/");
  const [uploadResult, thumbnailBlob] = await Promise.all([
    supabase.storage.from("inspiration-media").upload(path, file),
    isVideo ? generateVideoThumbnail(file) : Promise.resolve(null),
  ]);

  if (uploadResult.error) {
    throw new VaultCaptureError("failed", uploadResult.error.message || "Upload failed");
  }

  let thumbnailUrl: string | null = null;
  if (thumbnailBlob) {
    const thumbPath = `thumbnails/${session.user.id}/${ts}.jpg`;
    const { error: thumbErr } = await supabase.storage
      .from("inspiration-media")
      .upload(thumbPath, thumbnailBlob, { contentType: "image/jpeg" });
    if (!thumbErr) {
      const { data: signed } = await supabase.storage
        .from("inspiration-media")
        .createSignedUrl(thumbPath, 365 * 24 * 60 * 60);
      thumbnailUrl = signed?.signedUrl ?? null;
    }
  }

  const result = await callVaultFunction("vault-save", {
    file_path: path,
    platform: "upload",
    mime_type: file.type,
    brand_name: metadata?.brandName?.trim() || null,
    thumbnail_url: thumbnailUrl,
  });
  const itemId = result.item_id as string;
  await attachTagsAndNotes(itemId, metadata);
  return { itemId };
}

/** Capture whatever the surface has: a URL string or a media File. */
export async function captureToVault(
  input: VaultCaptureInput,
  metadata?: VaultCaptureMetadata,
  options?: VaultCaptureOptions,
): Promise<VaultCaptureResult> {
  return input.type === "url"
    ? captureUrlToVault(input.url, metadata, options)
    : captureFileToVault(input.file, metadata, options);
}

export type VaultCaptureStatus = "idle" | "capturing" | "saved" | "error";

export interface UseVaultCaptureResult {
  capture: (
    input: VaultCaptureInput,
    metadata?: VaultCaptureMetadata,
  ) => Promise<VaultCaptureResult | null>;
  captureUrl: (
    url: string,
    metadata?: VaultCaptureMetadata,
  ) => Promise<VaultCaptureResult | null>;
  captureFile: (
    file: File,
    metadata?: VaultCaptureMetadata,
  ) => Promise<VaultCaptureResult | null>;
  status: VaultCaptureStatus;
  isCapturing: boolean;
  error: VaultCaptureError | null;
  /** True when the failure means the surface should redirect to login. */
  needsLogin: boolean;
  /** True when the signed-in account's role may not capture. */
  forbidden: boolean;
  result: VaultCaptureResult | null;
  reset: () => void;
}

/**
 * React wrapper around the capture service for surfaces that just need
 * saving / saved / error states (the share-target route and the quick-add
 * page). It never throws — inspect `error`, `needsLogin`, and `forbidden`.
 */
export function useVaultCapture(options?: VaultCaptureOptions): UseVaultCaptureResult {
  const [status, setStatus] = useState<VaultCaptureStatus>("idle");
  const [error, setError] = useState<VaultCaptureError | null>(null);
  const [result, setResult] = useState<VaultCaptureResult | null>(null);

  const role = options?.role;

  const capture = useCallback(
    async (input: VaultCaptureInput, metadata?: VaultCaptureMetadata) => {
      setStatus("capturing");
      setError(null);
      setResult(null);
      try {
        const captured = await captureToVault(input, metadata, { role });
        setResult(captured);
        setStatus("saved");
        return captured;
      } catch (err) {
        const captureError =
          err instanceof VaultCaptureError
            ? err
            : new VaultCaptureError(
                "failed",
                err instanceof Error ? err.message : "Failed to save",
              );
        setError(captureError);
        setStatus("error");
        return null;
      }
    },
    [role],
  );

  const captureUrl = useCallback(
    (url: string, metadata?: VaultCaptureMetadata) =>
      capture({ type: "url", url }, metadata),
    [capture],
  );

  const captureFile = useCallback(
    (file: File, metadata?: VaultCaptureMetadata) =>
      capture({ type: "file", file }, metadata),
    [capture],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setResult(null);
  }, []);

  return {
    capture,
    captureUrl,
    captureFile,
    status,
    isCapturing: status === "capturing",
    error,
    needsLogin: isLoginRequired(error),
    forbidden: isCaptureForbidden(error),
    result,
    reset,
  };
}
