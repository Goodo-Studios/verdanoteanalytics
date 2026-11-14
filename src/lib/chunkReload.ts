/**
 * Recovery from a stale page after a deploy.
 *
 * A tab opened before a deploy still asks for the old hashed chunk files. The host answers those
 * requests with index.html (see the catch-all rewrite in vercel.json), so the dynamic import
 * fails and the whole app is replaced by the error page. One automatic reload fetches the new
 * build. A sessionStorage flag stops a reload loop if the failure is something else.
 */
const FLAG = "chunk-reloaded-at";
const WINDOW_MS = 30_000;

const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_ERROR.test(message);
}

/** Reloads once per 30 seconds. Returns true when it started a reload. */
export function reloadOnceForNewBuild(
  storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
  now: number = Date.now(),
): boolean {
  const last = Number(storage.getItem(FLAG) || 0);
  if (last && now - last < WINDOW_MS) return false;
  storage.setItem(FLAG, String(now));
  reload();
  return true;
}

export function installChunkReload() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForNewBuild()) event.preventDefault();
  });
}
