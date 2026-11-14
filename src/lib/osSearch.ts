// Cmd/Ctrl+K content search (Goodo OS OS-015): the rows os_search returns, grouped by kind, and
// the snippet highlight markers turned into plain text segments. Pure, so it is tested without
// the dialog. The snippet is never rendered as HTML: the palette renders each segment as text,
// with the matched ones inside a <mark> element.

export type OsSearchKind = "page" | "task" | "client";

export interface OsSearchRow {
  kind: OsSearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  /** Role-relative address; the palette adds the role prefix. */
  url_hint: string;
  rank: number;
}

export interface OsSearchGroup {
  kind: OsSearchKind;
  label: string;
  rows: OsSearchRow[];
}

/** Matched words come back between these two plain characters (U+27E6 and U+27E7). */
export const MARK_START = "⟦";
export const MARK_END = "⟧";

/** Fewer characters than this are not sent to the server. */
export const MIN_SEARCH_CHARS = 2;

export interface SnippetSegment {
  text: string;
  marked: boolean;
}

/**
 * Splits a snippet into text segments, marking the parts between the markers. A start marker
 * with no end marks to the end; a stray end marker is dropped. Empty segments are left out.
 */
export function parseSnippet(snippet: string | null | undefined): SnippetSegment[] {
  if (!snippet) return [];
  const out: SnippetSegment[] = [];
  let marked = false;
  let buf = "";
  const push = () => {
    if (buf) {
      const last = out[out.length - 1];
      if (last && last.marked === marked) last.text += buf;
      else out.push({ text: buf, marked });
    }
    buf = "";
  };
  for (const ch of snippet) {
    if (ch === MARK_START) {
      push();
      marked = true;
    } else if (ch === MARK_END) {
      push();
      marked = false;
    } else {
      buf += ch;
    }
  }
  push();
  return out;
}

/** The snippet with the markers removed. */
export function plainSnippet(snippet: string | null | undefined): string {
  return parseSnippet(snippet).map((s) => s.text).join("");
}

const GROUPS: Array<{ kind: OsSearchKind; label: string }> = [
  { kind: "page", label: "Pages" },
  { kind: "task", label: "Tasks" },
  { kind: "client", label: "Clients" },
];

const KINDS = new Set<string>(GROUPS.map((g) => g.kind));

/** Groups rows as Pages, Tasks, Clients, best rank first in each. Empty groups and unknown kinds are left out. */
export function groupResults(rows: OsSearchRow[]): OsSearchGroup[] {
  return GROUPS.map((g) => ({
    ...g,
    rows: rows.filter((r) => r.kind === g.kind).sort((a, b) => b.rank - a.rank),
  })).filter((g) => g.rows.length > 0);
}

/** Keeps only well-formed rows from the server. */
export function cleanRows(data: unknown): OsSearchRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (r): r is OsSearchRow =>
        !!r &&
        typeof r === "object" &&
        KINDS.has((r as OsSearchRow).kind) &&
        typeof (r as OsSearchRow).id === "string" &&
        typeof (r as OsSearchRow).title === "string" &&
        typeof (r as OsSearchRow).url_hint === "string" &&
        (r as OsSearchRow).url_hint.startsWith("/"),
    )
    .map((r) => ({ ...r, rank: Number(r.rank) || 0 }));
}
