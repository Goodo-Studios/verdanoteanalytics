// BID viewer model (consolidation step 6). Rows come from client_bids (staff-only row rule,
// migration 20261111020001). A BID is the BID Builder's markdown: a title, then sections
// that start with "## N. Title". The viewer is read-only.

export const BID_LIST_SELECT = "id, client_slug, version, title, source, data_origin, generated_at, imported_at";
export const BID_SELECT = `${BID_LIST_SELECT}, body_markdown, body_sha256, source_ref`;

export interface BidSummary {
  id: string;
  client_slug: string;
  version: number;
  title: string;
  source: "bid-builder" | "staging-seed";
  data_origin: "made_up" | "real";
  generated_at: string;
  imported_at: string;
}

export interface Bid extends BidSummary {
  body_markdown: string;
  body_sha256: string;
  source_ref: string;
}

export interface BidSection {
  /** Anchor id, stable for the same heading text. */
  anchor: string;
  /** The heading text without the leading "## ". Empty for text before the first section. */
  heading: string;
  /** Markdown of the section without its heading line. */
  body: string;
}

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";

/** Splits the markdown at level-2 headings. Headings inside fenced code are ignored. */
export function splitSections(markdown: string): BidSection[] {
  const sections: BidSection[] = [];
  let heading = "";
  let buf: string[] = [];
  let fenced = false;
  const used = new Map<string, number>();
  const push = () => {
    const body = buf.join("\n").trim();
    if (!heading && !body) return;
    const base = heading ? slug(heading) : "intro";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    sections.push({ anchor: `bid-${base}${n > 1 ? `-${n}` : ""}`, heading, body });
  };
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced ? /^## (?!#)(.+?)\s*#*\s*$/.exec(line) : null;
    if (m) {
      push();
      heading = m[1].trim();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  push();
  return sections;
}

/** Latest version first for each client; clients ordered by name. */
export function latestByClient(rows: BidSummary[]): Map<string, BidSummary[]> {
  const out = new Map<string, BidSummary[]>();
  for (const r of rows) out.set(r.client_slug, [...(out.get(r.client_slug) ?? []), r]);
  for (const [k, list] of out) out.set(k, list.sort((a, b) => b.version - a.version));
  return out;
}

export function originLabel(b: Pick<BidSummary, "data_origin" | "source">): string {
  if (b.data_origin === "made_up") return "Made-up staging BID";
  return b.source === "bid-builder" ? "From the BID Builder" : b.source;
}

