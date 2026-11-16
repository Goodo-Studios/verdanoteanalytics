// Vault storage paths (audit plan item 2.2).
//
// Functions sign whatever file_path an item stores, so a stored path must be a well-formed
// Vault path before it is signed, and a caller-supplied path must be the caller's own upload.
//
// Folders in use in production (2026-11-15): atria/{uid}/ (imported library), uploads/{uid}/
// (app uploads and extract webhook), analytics/{uid}/ (saved from the creative library),
// thumbnails/{uid}/. slack/{uid}/ was used by the removed Slack import. The folder's user is the
// person who saved the file, which is not always the item's user_id (38 production items), so
// signing does not require it to match: the Vault is staff only and staff manage every item.

const VAULT_FOLDERS = new Set(["atria", "uploads", "analytics", "thumbnails", "slack"]);

/** A path the Vault functions may sign: known folder, a user folder, a file name, nothing odd. */
export function isSignableVaultPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const parts = path.split("/");
  if (parts.length < 3) return false;
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  return VAULT_FOLDERS.has(parts[0]);
}

/** A file_path a caller may hand to vault-save: their own upload, as useVaultCapture names it. */
export function isOwnUploadPath(path: unknown, userId: string): path is string {
  return isSignableVaultPath(path) && path.split("/").length === 3 && path.startsWith(`uploads/${userId}/`);
}

/** What the public share page needs instead of the stored path. */
export function mediaKindForPath(path: string | null | undefined): "image" | "video" | null {
  if (!path) return null;
  return /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(path) ? "image" : "video";
}
