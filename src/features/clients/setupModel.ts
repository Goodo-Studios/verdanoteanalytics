// Client setup (phase 4, PR 1): pure helpers for the client hub's Setup tab and the checklist on
// the Team and settings page. No network here. The data comes from client_ad_accounts and
// source_mappings (staff row rules) and from client_setup_status() and list_client_members()
// (migration 20261112000001).

export interface SetupStatus {
  client_slug: string;
  ad_account_count: number;
  clickup_folder_count: number;
  member_count: number;
  last_clickup_sync: string | null;
}

export interface ChecklistItem {
  key: "ad_account" | "clickup" | "login" | "sync";
  label: string;
  done: boolean;
  detail: string;
}

const MIN = 60_000;

/** "3 hours ago", "yesterday", "Nov 3, 2026". Plain words, no clock times. */
export function syncAgo(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (Number.isNaN(diff)) return "never";
  if (diff < MIN) return "just now";
  const minutes = Math.floor(diff / MIN);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The four-line checklist for one client. A missing status row (not loaded yet) counts as nothing set up. */
export function buildChecklist(status: SetupStatus | null | undefined, now: Date): ChecklistItem[] {
  const s: SetupStatus = status ?? { client_slug: "", ad_account_count: 0, clickup_folder_count: 0, member_count: 0, last_clickup_sync: null };
  return [
    {
      key: "ad_account",
      label: "Ad account linked",
      done: s.ad_account_count > 0,
      detail: s.ad_account_count > 0 ? plural(s.ad_account_count, "ad account", "ad accounts") : "No ad account yet",
    },
    {
      key: "clickup",
      label: "ClickUp folder linked",
      done: s.clickup_folder_count > 0,
      detail: s.clickup_folder_count > 0 ? "Linked" : "No ClickUp folder yet",
    },
    {
      key: "login",
      label: "Client login created",
      done: s.member_count > 0,
      detail: s.member_count > 0 ? plural(s.member_count, "login", "logins") : "No client login yet",
    },
    {
      key: "sync",
      label: "ClickUp last synced",
      done: !!s.last_clickup_sync,
      detail: s.last_clickup_sync ? syncAgo(s.last_clickup_sync, now) : "Never synced",
    },
  ];
}

/** How many of the four steps are done, for the short line on the Team page. */
export function checklistSummary(items: ChecklistItem[]): string {
  const done = items.filter((i) => i.done).length;
  return `${done} of ${items.length} set up`;
}

export interface ParsedClickUpId {
  id: string;
  /** Set when a pasted ClickUp link says which kind it is. */
  kind: "folder" | "list" | null;
}

/**
 * Accepts what a person is likely to paste: the bare id, or the link ClickUp shows for a folder
 * (".../v/o/f/90170123456") or a list (".../v/li/901701234567"). Returns null for anything else.
 */
export function parseClickUpId(input: string): ParsedClickUpId | null {
  const text = input.trim();
  if (!text) return null;
  const link = /\/(f|li)\/([0-9]{4,40})(?:[/?#]|$)/.exec(text);
  if (link) return { id: link[2], kind: link[1] === "f" ? "folder" : "list" };
  if (/^[0-9]{4,40}$/.test(text)) return { id: text, kind: null };
  return null;
}

export const CLICKUP_ID_HELP =
  "In ClickUp, open the folder and copy its link. Paste the whole link or just the long number at the end of it.";

export const NO_LOOKUP_NOTE =
  "ClickUp is not connected here, so the folders cannot be listed. Paste the folder link or id instead.";

export interface DbErrorLike {
  code?: string;
  message: string;
}

/** Plain wording for the errors a link or unlink can hit. Messages written by the functions pass through. */
export function setupErrorText(error: DbErrorLike | null | undefined, what: "ad_account" | "mapping" | "member"): string {
  if (!error) return "Something went wrong. Try again.";
  if (error.code === "42501") return "Only a builder can change a client's setup.";
  if (error.code === "23505") {
    if (what === "ad_account") return "That ad account is already linked to a client. Unlink it there first.";
    if (what === "mapping") return "That ClickUp folder is already linked to a client. Each folder belongs to one client.";
    return "That login is already linked to this client.";
  }
  if (error.code === "23503") return "We could not find that client or ad account. Reload the page and try again.";
  if (what === "member" && (error.code === "P0002" || error.code === "22023")) return error.message;
  return "The change could not be saved. Try again, and tell a builder if it keeps happening.";
}

export interface FolderChoice {
  id: string;
  name: string;
  lists: { id: string; name: string }[];
}

/** Folders already linked to another client cannot be picked twice; the picker marks them. */
export function folderLabel(folder: FolderChoice, takenBy: string | undefined): string {
  return takenBy ? `${folder.name} (linked to ${takenBy})` : folder.name;
}
