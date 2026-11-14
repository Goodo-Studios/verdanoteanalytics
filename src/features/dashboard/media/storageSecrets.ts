// Approving an application that has files, and deleting a location that has photos, move
// files through storage_admin_request (migration 20261101000002). That function reads two
// vault secrets, storage_signing_project_url and storage_signing_service_role_key. When one
// is missing the database raises config_file_error (code F0000) and rolls the whole change
// back. This turns that into a sentence a person can act on. Names only, never values.

export const STORAGE_SECRET_NAMES = ["storage_signing_project_url", "storage_signing_service_role_key"] as const;

/** True when the database error means a storage signing secret is missing. */
export function isStorageSecretError(code: string | undefined, message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return code === "F0000" || m.includes("not present in vault.secrets") || m.includes("storage_signing_");
}

/**
 * Plain wording for a missing storage secret, or null when the error is something else.
 * `doing` finishes "so ...", for example "copying the applicant's files".
 */
export function storageSecretsText(code: string | undefined, message: string | undefined, doing: string): string | null {
  if (!isStorageSecretError(code, message)) return null;
  return `Media storage is not connected on this site yet, so ${doing} could not be done. Nothing was changed. Ask the Verdanote owner to add the storage signing secrets (${STORAGE_SECRET_NAMES.join(" and ")}) to the database vault, then try again.`;
}
