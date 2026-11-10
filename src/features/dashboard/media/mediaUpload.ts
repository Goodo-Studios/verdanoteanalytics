// One file, from the browser to storage (phase 6b). The page asks storage for a signed upload
// link for a new path (storage checks the staff write policy on the bucket when it signs, so a
// client login gets an error here), then the browser sends the file straight to that link with
// progress, then the row for it is added. If the row cannot be added the file is removed
// again, so a failed upload leaves nothing behind.
//
// This file is loaded only when someone opens the uploader.
import { supabase } from "@/integrations/supabase/client";
import { insertMediaRow, removeObjects, setHeadshot, type NewRowDetails } from "./mediaApi";
import { MediaError, buildPath, titleFromName, type MediaKindConfig } from "./mediaModel";

export interface UploadProgress {
  (percent: number): void;
}

/** Storage answers errors as { statusCode, error, message }. */
function storageMessage(text: string): string {
  try {
    const j = JSON.parse(text) as { message?: string; error?: string };
    return j.message || j.error || text;
  } catch {
    return text;
  }
}

/** PUT of the file to a signed upload link, reporting progress as the browser sends it. */
export function putWithProgress(url: string, file: File, onProgress: UploadProgress, apiKey: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Same body as the storage client sends for a signed upload: a form with one unnamed file part.
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.setRequestHeader("x-upsert", "false");
    if (apiKey) xhr.setRequestHeader("apikey", apiKey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new MediaError(storageMessage(xhr.responseText || `Storage answered ${xhr.status}.`), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new MediaError("The upload was interrupted.", { code: "network" }));
    xhr.ontimeout = () => reject(new MediaError("The upload timed out.", { code: "network" }));
    xhr.onabort = () => reject(new MediaError("The upload was interrupted.", { code: "network" }));
    xhr.send(body);
  });
}

export interface UploadJob {
  cfg: MediaKindConfig;
  ownerId: string;
  file: File;
  /** The checked type, which may differ from file.type when the browser left it blank. */
  mime: string;
  category?: "family" | "pet";
  /** For a headshot: the current path, removed once the new one is saved. */
  currentHeadshot?: string | null;
  onProgress: UploadProgress;
  onSaving?: () => void;
}

export interface UploadSteps {
  sign(bucket: string, path: string): Promise<string>;
  put(url: string, file: File, onProgress: UploadProgress): Promise<void>;
  save(job: UploadJob, path: string): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
}

async function signUpload(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    const e = (error ?? {}) as { message?: string; status?: number; statusCode?: number | string };
    throw new MediaError(e.message ?? "Storage did not give an upload link.", { status: e.status ?? (Number(e.statusCode) || undefined) });
  }
  return data.signedUrl;
}

async function saveRow(job: UploadJob, path: string): Promise<void> {
  const { cfg, ownerId } = job;
  if (cfg.headshot) return setHeadshot(cfg, ownerId, path, job.currentHeadshot ?? null);
  const details: NewRowDetails = { title: titleFromName(job.file.name) || null, size: job.file.size, mime: job.mime, category: job.category };
  await insertMediaRow(cfg, ownerId, path, details);
}

export const DEFAULT_STEPS: UploadSteps = {
  sign: signUpload,
  put: putWithProgress,
  save: saveRow,
  remove: (bucket, path) => removeObjects(bucket, [path]),
};

/** Uploads one file and adds its row. Resolves with the new storage path. */
export async function uploadMediaFile(job: UploadJob, steps: UploadSteps = DEFAULT_STEPS): Promise<string> {
  const path = buildPath(job.cfg, job.ownerId, job.mime);
  const file = job.file.type === job.mime ? job.file : new File([job.file], job.file.name, { type: job.mime });
  const url = await steps.sign(job.cfg.bucket, path);
  await steps.put(url, file, job.onProgress);
  job.onSaving?.();
  try {
    await steps.save(job, path);
  } catch (e) {
    await steps.remove(job.cfg.bucket, path).catch(() => undefined);
    throw e;
  }
  return path;
}
