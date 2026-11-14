// Pure text edits behind the document editor toolbar. Documents are stored as markdown, so each
// helper takes the text and the selection (start, end) and returns the new text and selection.

export interface Edit {
  text: string;
  start: number;
  end: number;
}

/** Wrap the selection in `mark` (**bold**, _italic_). With no selection, insert a placeholder. Wrapping again unwraps. */
export function wrapSelection(text: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const selected = text.slice(start, end);
  const before = text.slice(0, start);
  const after = text.slice(end);
  if (selected && before.endsWith(mark) && after.startsWith(mark)) {
    return { text: before.slice(0, -mark.length) + selected + after.slice(mark.length), start: start - mark.length, end: end - mark.length };
  }
  if (selected.length > 2 * mark.length && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(mark.length, -mark.length);
    return { text: before + inner + after, start, end: start + inner.length };
  }
  const body = selected || placeholder;
  return { text: `${before}${mark}${body}${mark}${after}`, start: start + mark.length, end: start + mark.length + body.length };
}

/** Start and end of the lines the selection touches. */
function lineRange(text: string, start: number, end: number): [number, number] {
  const from = text.lastIndexOf("\n", Math.max(0, start) - 1) + 1;
  const nl = text.indexOf("\n", end);
  return [from, nl === -1 ? text.length : nl];
}

/** Make the selected lines a heading of `level` (1 to 3). A line that already is that heading goes back to a paragraph. */
export function setHeading(text: string, start: number, end: number, level: 1 | 2 | 3): Edit {
  const [from, to] = lineRange(text, start, end);
  const marker = `${"#".repeat(level)} `;
  const lines = text.slice(from, to).split("\n").map((line) => {
    const plain = line.replace(/^#{1,6}\s+/, "");
    return line.startsWith(marker) ? plain : marker + plain;
  });
  const block = lines.join("\n");
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

/** Turn the selected lines into a bullet list, or back into plain lines when they all are bullets already. */
export function toggleBullets(text: string, start: number, end: number): Edit {
  const [from, to] = lineRange(text, start, end);
  const lines = text.slice(from, to).split("\n");
  const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
  const content = lines.filter((l) => l.trim() !== "");
  const allBullets = content.length > 0 && content.every(isBullet);
  const next = lines.map((l) => {
    if (l.trim() === "") return l;
    if (allBullets) return l.replace(/^(\s*)[-*]\s+/, "$1");
    return isBullet(l) ? l : `- ${l.replace(/^#{1,6}\s+/, "")}`;
  });
  const block = next.join("\n");
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

/** A web address with a scheme, a mailto link or a page anchor is kept; anything else gets https://. Empty gives null. */
export function normalizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url || /\s/.test(url)) return null;
  if (/^(https?:\/\/|mailto:|#)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // javascript: and other schemes are refused
  return `https://${url}`;
}

/** Make the selection a link to `url`; with no selection the link text is the address. Returns null for an unusable address. */
export function insertLink(text: string, start: number, end: number, rawUrl: string): Edit | null {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  const label = text.slice(start, end) || url;
  const md = `[${label}](${url})`;
  return { text: text.slice(0, start) + md + text.slice(end), start, end: start + md.length };
}
