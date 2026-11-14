// Decides whether this environment may change anything in ClickUp.
//
// Staging reads real ClickUp data but must never change a live client task:
// staging has test logins, so a test click there must not reach a real task.
//
// Writes are blocked when either is true:
//   * SUPABASE_URL points at the staging project (checked by project ref, so the
//     block holds even if the flag below is missing), or
//   * CLICKUP_WRITES is set to "off".
//
// While blocked, writes are allowed only into the list ids in
// CLICKUP_WRITE_ALLOWED_LIST_IDS (comma separated). That list is empty by
// default; it exists for the stage 4 test list. Production sets neither, so
// production behaves exactly as before.

export const STAGING_PROJECT_REF = "mnvcksbhbvypuiwozvct";

export type Env = (name: string) => string | undefined;

export interface ClickUpWritePolicy {
  blocked: boolean;
  reason: "staging" | "flag" | null;
  allowedListIds: ReadonlySet<string>;
}

export function clickUpWritePolicy(env: Env): ClickUpWritePolicy {
  const url = env("SUPABASE_URL") ?? "";
  const isStaging = url.includes(STAGING_PROJECT_REF);
  const flagOff = (env("CLICKUP_WRITES") ?? "").trim().toLowerCase() === "off";
  const allowedListIds = new Set(
    (env("CLICKUP_WRITE_ALLOWED_LIST_IDS") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id)),
  );
  if (isStaging) return { blocked: true, reason: "staging", allowedListIds };
  if (flagOff) return { blocked: true, reason: "flag", allowedListIds };
  return { blocked: false, reason: null, allowedListIds: new Set() };
}

export function mayWriteToList(policy: ClickUpWritePolicy, listId: string | null | undefined): boolean {
  if (!policy.blocked) return true;
  return !!listId && policy.allowedListIds.has(String(listId));
}

export const READ_ONLY_MESSAGE =
  "ClickUp is read-only in this environment. Nothing was changed in ClickUp.";
