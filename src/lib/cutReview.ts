// Cut review (OS-020). Pure rules for versions and timestamped comments. Nothing here reads or
// writes data.
//
// A version is a link to one cut of a task. A cut comment belongs to one version and may carry a
// timecode in milliseconds (null: about the whole cut). Clients only ever get client-thread
// comments from the server; toCutComments drops anything else again when asked to (client view).

export type CommentThread = "internal" | "client";

export interface TaskVersion {
  id: string;
  version_no: number;
  label: string | null;
  video_url: string;
  created_at: string;
}

export interface CutComment {
  id: number;
  thread: CommentThread;
  body: string;
  timecode_ms: number | null;
  created_at: string;
  author_user_id: string | null;
  author_name: string | null;
}

/** Video files a browser can play inline. Anything else (Air, Drive, Frame, Vimeo) opens in a new tab. */
const DIRECT_VIDEO = /\.(mp4|m4v|webm|mov|ogv|ogg)$/i;

/** True when the link points straight at a video file over https, so a <video> element can play it. */
export function isDirectVideo(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && DIRECT_VIDEO.test(u.pathname);
  } catch {
    return false;
  }
}

/** 65000 -> "1:05", 3723000 -> "1:02:03". Fractions of a second are dropped. */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * "1:05" or "01:05" (m:ss) and "1:02:03" (h:mm:ss) to milliseconds. Seconds and minutes after the
 * first part must be 0 to 59. Returns null for anything else, including an empty string.
 */
export function parseTimecode(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(:\d{1,2}){1,2}$/.test(t)) return null;
  const parts = t.split(":").map((p) => Number(p));
  const rest = parts.slice(1);
  if (rest.some((p) => p > 59)) return null;
  if (rest.some((_, i) => t.split(":")[i + 1].length !== 2)) return null;
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return ((h * 60 + m) * 60 + s) * 1000;
}

/** Newest version first. */
export function sortVersions(versions: TaskVersion[]): TaskVersion[] {
  return versions.slice().sort((a, b) => b.version_no - a.version_no);
}

/** "Version 2" or "Version 2: Shorter hook". */
export function versionName(v: Pick<TaskVersion, "version_no" | "label">): string {
  return v.label ? `Version ${v.version_no}: ${v.label}` : `Version ${v.version_no}`;
}

/** By timecode, whole-cut comments last, then by time posted, then id, so the order is steady. */
export function sortByTimecode<T extends Pick<CutComment, "timecode_ms" | "created_at" | "id">>(comments: T[]): T[] {
  return comments.slice().sort((a, b) => {
    if (a.timecode_ms !== b.timecode_ms) {
      if (a.timecode_ms === null) return 1;
      if (b.timecode_ms === null) return -1;
      return a.timecode_ms - b.timecode_ms;
    }
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id - b.id;
  });
}

/** Keep known keys only. Drops rows with no id, a bad link, or (for a client) any non-client thread. */
export function toVersions(rows: unknown): TaskVersion[] {
  if (!Array.isArray(rows)) return [];
  const out: TaskVersion[] = [];
  for (const raw of rows) {
    const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
    if (!r || typeof r.id !== "string" || typeof r.video_url !== "string" || !/^https:\/\//i.test(r.video_url)) continue;
    out.push({
      id: r.id,
      version_no: Number(r.version_no) || 0,
      label: typeof r.label === "string" && r.label.trim() ? r.label : null,
      video_url: r.video_url,
      created_at: String(r.created_at ?? ""),
    });
  }
  return sortVersions(out);
}

export function toCutComments(rows: unknown, opts: { clientOnly: boolean }): CutComment[] {
  if (!Array.isArray(rows)) return [];
  const out: CutComment[] = [];
  for (const raw of rows) {
    const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
    if (!r || typeof r.id !== "number" || typeof r.body !== "string") continue;
    if (r.thread !== "internal" && r.thread !== "client") continue;
    if (opts.clientOnly && r.thread !== "client") continue;
    const a = (r.author && typeof r.author === "object" ? r.author : {}) as Record<string, unknown>;
    const name = [a.name, a.username, a.email].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    out.push({
      id: r.id,
      thread: r.thread,
      body: r.body,
      timecode_ms: typeof r.timecode_ms === "number" && r.timecode_ms >= 0 ? r.timecode_ms : null,
      created_at: String(r.created_at ?? ""),
      author_user_id: typeof r.author_user_id === "string" ? r.author_user_id : null,
      author_name: opts.clientOnly ? null : (name ?? null),
    });
  }
  return sortByTimecode(out);
}

/** Move the player to a moment. */
export function seekTo(video: HTMLVideoElement | null, ms: number) {
  if (!video) return;
  video.currentTime = ms / 1000;
}
