// Pure rules for push-brief-to-clickup (replaces the removed "Push to Coda" and
// "Create brief in Coda" actions; Coda was retired on 2026-10-09).
//
// No network and no database here, so every rule is covered by plain Deno tests.

import { isAssetTask } from "./clickup-pipeline.ts";

/** The status a brief is pushed into. ClickUp status names are lowercase. */
export const BRIEF_STATUS = "brief creation";

/** Statuses of asset tasks offered in the picker (empty description required too). */
export const PICKER_STATUSES = new Set(["assigned", BRIEF_STATUS]);

/** Goodo works on US Pacific time; "the current month" is the month there. */
export const GOODO_TIME_ZONE = "America/Los_Angeles";

export const MAX_TITLE_CHARS = 120;
export const MAX_BODY_CHARS = 50_000;

/** ClickUp task ids are short lowercase alphanumerics (for example 86bcpukvk). */
export const SAFE_TASK_ID = /^[a-z0-9]{4,20}$/i;
export const SAFE_CLIENT_SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/i;
export const SAFE_ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const SAFE_AD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface ClickUpBriefTask {
  id: string;
  name?: string;
  url?: string;
  status?: { status?: string };
  list?: { id?: string };
  description?: string | null;
  text_content?: string | null;
  markdown_description?: string | null;
}

/** True when the task holds no description in any of the forms ClickUp returns. */
export function isDescriptionEmpty(task: ClickUpBriefTask): boolean {
  return [task.description, task.text_content, task.markdown_description].every(
    (v) => typeof v !== "string" || v.trim() === "",
  );
}

export function taskStatus(task: ClickUpBriefTask): string {
  return (task.status?.status ?? "").trim().toLowerCase();
}

/** An asset task that may receive a brief from the picker. */
export function isPickable(task: ClickUpBriefTask): boolean {
  return isAssetTask(task.name) && isDescriptionEmpty(task) && PICKER_STATUSES.has(taskStatus(task));
}

export function taskUrl(task: ClickUpBriefTask): string {
  return typeof task.url === "string" && task.url.startsWith("https://")
    ? task.url
    : `https://app.clickup.com/t/${task.id}`;
}

/** Asset number in a task name ("November Asset 12 - Hook" -> 12), or null. */
export function assetNumber(name: string | null | undefined): number | null {
  const m = /\basset\s*(\d+)/i.exec(name ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Next asset number in a list. Numbering runs on across months in a client
 * list (a list read on 2026-11-09 had "November Asset 38"), so this is the
 * highest asset number of any month plus one.
 */
export function nextAssetNumber(taskNames: (string | null | undefined)[]): number {
  let max = 0;
  for (const name of taskNames) {
    if (!isAssetTask(name)) continue;
    const n = assetNumber(name);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

export function currentMonthName(now: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: GOODO_TIME_ZONE }).format(now);
}

/**
 * Plain markdown only. ClickUp stores HTML tags in a markdown description as raw
 * text (company rule: never write an HTML sub tag). A sub-tag note becomes an
 * italic line; any other tag is removed and its text kept.
 */
export function toPlainMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Markdown autolinks (<https://...>) become the bare URL, which ClickUp links.
    .replace(/<(https?:\/\/[^>\s]+)>/gi, "$1")
    .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub\s*>/gi, (_m, inner: string) => {
      const t = inner.replace(/<\/?[a-z][^>]*>/gi, "").trim();
      return t ? `*${t}*` : "";
    })
    // Anything else that looks like a tag goes; its inner text stays.
    .replace(/<\/?[a-z][^>]*>/gi, "");
}

/** One line, no tags, no surrounding space, at most MAX_TITLE_CHARS. */
export function cleanTitle(title: string): string {
  return toPlainMarkdown(title).replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS).trim();
}

export function newTaskName(month: string, n: number, title: string): string {
  return `${month} Asset ${n} - ${title}`;
}

export interface CreativeReference {
  ad_id: string;
  ad_name?: string | null;
}

/** The Meta Ad Library link the Coda version put in the brief note. */
export function adLibraryUrl(adId: string): string {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adId)}`;
}

/** The markdown written into the task description. */
export function buildBriefDescription(body: string, creative?: CreativeReference | null): string {
  const parts = [toPlainMarkdown(body).trim()];
  if (creative) {
    const label = cleanTitle(creative.ad_name || "") || creative.ad_id;
    parts.push(`**Reference creative:** ${label}\n${adLibraryUrl(creative.ad_id)}`);
  }
  parts.push("*Pushed from Verdanote.*");
  return parts.filter(Boolean).join("\n\n");
}

/** Matches any HTML-like tag. Used by tests and as a last check before sending. */
export const HTML_TAG = /<\/?[a-z][^>]*>/i;
