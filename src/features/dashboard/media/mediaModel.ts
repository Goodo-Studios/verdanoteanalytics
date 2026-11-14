// Media upload and delete for creators, actors and locations (phase 6b). Pure rules only:
// what each kind of file is stored as, which files are accepted, and the plain wording of
// errors. The calls are in mediaApi.ts and mediaUpload.ts.
//
// Layout (kept so files from the old dashboard and new files sit side by side):
//   bucket creator-videos            <creator id>/video-<name>
//   bucket creator-headshots         <creator id>/headshot-<name>
//   bucket location-photos           <location id>/<file>
// New files are named <owner id>/<headshot|video|photo|location>-<uuid>.<ext>, so a new
// file can never take the path of an old one.

export type MediaKind =
  | "creator-headshot"
  | "creator-video"
  | "creator-photo"
  | "creator-location"
  | "actor-headshot"
  | "actor-video"
  | "actor-photo"
  | "location-photo";

export interface MediaKindConfig {
  kind: MediaKind;
  /** Singular and plural, for sentences: "video", "videos". */
  noun: string;
  plural: string;
  bucket: string;
  /** Row table, or null for a headshot (stored on the owner row). */
  table: string | null;
  ownerColumn: string | null;
  /** For a headshot: the table and column that hold the path. */
  headshot: { table: string; column: string } | null;
  type: "image" | "video";
  /** Same as the bucket's own limit, so a file that passes here is not refused by storage. */
  maxBytes: number;
  /** The most files one owner may hold (the database enforces these too), or null. */
  maxCount: number | null;
  /** Bucket the video thumbnail lives in, when a row has one. */
  thumbBucket: string | null;
  /** Word used in the path: <owner>/<prefix>-<uuid>.<ext>. */
  pathPrefix: "headshot" | "video" | "photo" | "location";
}

const MB = 1024 * 1024;

export const MEDIA_KINDS: Record<MediaKind, MediaKindConfig> = {
  "creator-headshot": { kind: "creator-headshot", noun: "headshot", plural: "headshots", bucket: "creator-headshots", table: null, ownerColumn: null, headshot: { table: "dashboard_creators", column: "headshot_path" }, type: "image", maxBytes: 5 * MB, maxCount: 1, thumbBucket: null, pathPrefix: "headshot" },
  "creator-video": { kind: "creator-video", noun: "video", plural: "videos", bucket: "creator-videos", table: "creator_videos", ownerColumn: "creator_id", headshot: null, type: "video", maxBytes: 100 * MB, maxCount: 10, thumbBucket: "creator-headshots", pathPrefix: "video" },
  "creator-photo": { kind: "creator-photo", noun: "photo", plural: "photos", bucket: "creator-family-pet-photos", table: "creator_photos", ownerColumn: "creator_id", headshot: null, type: "image", maxBytes: 5 * MB, maxCount: null, thumbBucket: null, pathPrefix: "photo" },
  "creator-location": { kind: "creator-location", noun: "photo", plural: "photos", bucket: "creator-filming-locations", table: "creator_filming_locations", ownerColumn: "creator_id", headshot: null, type: "image", maxBytes: 5 * MB, maxCount: null, thumbBucket: null, pathPrefix: "location" },
  "actor-headshot": { kind: "actor-headshot", noun: "headshot", plural: "headshots", bucket: "actor-headshots", table: null, ownerColumn: null, headshot: { table: "actors", column: "headshot_path" }, type: "image", maxBytes: 5 * MB, maxCount: 1, thumbBucket: null, pathPrefix: "headshot" },
  "actor-video": { kind: "actor-video", noun: "video", plural: "videos", bucket: "actor-videos", table: "actor_videos", ownerColumn: "actor_id", headshot: null, type: "video", maxBytes: 250 * MB, maxCount: 8, thumbBucket: "actor-videos", pathPrefix: "video" },
  "actor-photo": { kind: "actor-photo", noun: "photo", plural: "photos", bucket: "actor-photos", table: "actor_photos", ownerColumn: "actor_id", headshot: null, type: "image", maxBytes: 5 * MB, maxCount: 8, thumbBucket: null, pathPrefix: "photo" },
  "location-photo": { kind: "location-photo", noun: "photo", plural: "photos", bucket: "location-photos", table: "location_photos", ownerColumn: "location_id", headshot: null, type: "image", maxBytes: 5 * MB, maxCount: null, thumbBucket: null, pathPrefix: "photo" },
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;

const EXTENSION_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
};
const TYPE_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** The value for the file input's accept attribute. */
export const acceptFor = (cfg: MediaKindConfig): string => [...(cfg.type === "image" ? IMAGE_TYPES : VIDEO_TYPES)].join(",");

/** The file's type, from the browser or, when the browser leaves it blank (common for .mov), the extension. */
export function mimeOf(file: Pick<File, "name" | "type">): string {
  const given = (file.type || "").toLowerCase();
  if (given) return given;
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  return EXTENSION_TYPE[ext] ?? "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}

const limitText = (cfg: MediaKindConfig) => `${Math.round(cfg.maxBytes / MB)} MB`;

export function typeHelp(cfg: MediaKindConfig): string {
  return cfg.type === "image" ? "JPG, PNG or WebP" : "MP4 or MOV";
}

/** One line under the picker: what is accepted. */
export function limitsText(cfg: MediaKindConfig): string {
  const count = cfg.maxCount && cfg.maxCount > 1 ? ` Up to ${cfg.maxCount} ${cfg.plural} in all.` : "";
  return `${typeHelp(cfg)}, up to ${limitText(cfg)} each.${count}`;
}

/** Why one file is refused, in plain words, or null when it is fine. */
export function validateFile(cfg: MediaKindConfig, file: Pick<File, "name" | "type" | "size">): string | null {
  const mime = mimeOf(file);
  const allowed: readonly string[] = cfg.type === "image" ? IMAGE_TYPES : VIDEO_TYPES;
  if (!allowed.includes(mime)) return `${file.name} is not a ${typeHelp(cfg)} file. Pick a ${cfg.type === "image" ? "photo" : "video"} in one of those formats.`;
  if (file.size <= 0) return `${file.name} is empty.`;
  if (file.size > cfg.maxBytes) return `${file.name} is ${formatBytes(file.size)}, and the limit is ${limitText(cfg)}. Make it smaller and try again.`;
  return null;
}

export interface Accepted {
  file: File;
  mime: string;
}
export interface Rejected {
  name: string;
  reason: string;
}

/**
 * Splits a picked batch into the files to upload and the ones refused. `existing` is how many
 * the owner already holds; once the cap is reached the rest are refused with a plain message.
 */
export function validateBatch(cfg: MediaKindConfig, files: File[], existing: number): { accepted: Accepted[]; rejected: Rejected[] } {
  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  for (const file of files) {
    const reason = validateFile(cfg, file);
    if (reason) {
      rejected.push({ name: file.name, reason });
      continue;
    }
    if (cfg.maxCount !== null && cfg.maxCount > 1 && existing + accepted.length >= cfg.maxCount) {
      rejected.push({ name: file.name, reason: `${file.name} was not added. There is room for ${cfg.maxCount} ${cfg.plural}. Remove one first.` });
      continue;
    }
    accepted.push({ file, mime: mimeOf(file) });
  }
  return { accepted, rejected };
}

/** <owner id>/<prefix>-<uuid>.<ext>. The extension comes from the checked type, never from the file name. */
export function buildPath(cfg: MediaKindConfig, ownerId: string, mime: string, uuid: string = crypto.randomUUID()): string {
  return `${ownerId}/${cfg.pathPrefix}-${uuid}.${TYPE_EXTENSION[mime] ?? "bin"}`;
}

/** The next free position: one past the highest in use, or 0 for the first. */
export function nextSortOrder(existing: number[]): number {
  return existing.length ? Math.max(...existing) + 1 : 0;
}

/** A name to show for a file picked from disk, without the extension. */
export function titleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120);
}

// ------------------------------------------------------------------ errors

export class MediaError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message);
    this.code = opts.code;
    this.status = opts.status;
  }
}

/** Plain wording for anything that can go wrong while uploading or deleting. */
export function mediaErrorText(e: unknown, cfg?: MediaKindConfig): string {
  const code = (e as { code?: string } | null)?.code;
  const status = (e as { status?: number; statusCode?: number | string } | null)?.status ?? Number((e as { statusCode?: number | string } | null)?.statusCode);
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const m = raw.toLowerCase();
  if (code === "42501" || status === 401 || status === 403 || m.includes("row-level security") || m.includes("not authorized") || m.includes("unauthorized")) {
    return "You do not have permission to change files here. Sign in again, or ask an owner for access.";
  }
  if (status === 413 || m.includes("exceeded the maximum allowed size") || m.includes("too large") || m.includes("payload")) {
    return `That file is too large for storage${cfg ? ` (the limit is ${limitText(cfg)})` : ""}. Make it smaller and try again.`;
  }
  if (m.includes("mime type") || m.includes("not supported") || status === 415) return `Storage did not accept that file type. Use ${cfg ? typeHelp(cfg) : "a supported format"}.`;
  if (code === "23514") return `This already has the most ${cfg?.plural ?? "files"} allowed. Remove one first.`;
  if (code === "23505") return "Another upload took that place in the list. Try again.";
  if (code === "23503" || code === "P0002") return "The person or place these files belong to no longer exists.";
  if (code === "network" || m.includes("network") || m.includes("failed to fetch") || m.includes("interrupted") || m.includes("timed out")) {
    return "The upload was interrupted. Check your connection and try again.";
  }
  return raw || "Something went wrong. Try again.";
}

// ------------------------------------------------------------------ upload queue

export type QueueStatus = "queued" | "uploading" | "saving" | "done" | "failed";

export interface QueueItem {
  id: string;
  name: string;
  size: number;
  status: QueueStatus;
  /** 0 to 100 while uploading. */
  progress: number;
  error?: string;
}

export function summarizeQueue(items: QueueItem[]): string {
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const waiting = items.length - done - failed;
  const parts: string[] = [];
  if (done) parts.push(`${done} uploaded`);
  if (waiting) parts.push(`${waiting} in progress`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(", ");
}
