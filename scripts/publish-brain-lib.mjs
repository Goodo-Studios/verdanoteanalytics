// Pure rules for publishing HQ knowledge into the app's Brain (story OS-014).
// scripts/publish-brain.mjs does the reading and writing; everything here is testable.
//
// Folder to section (the first folder under the knowledge root):
//   company    -> Handbook
//   processes  -> Playbooks
//   clients    -> Clients
//   insights   -> Insights
// Every other folder (slack, archive, brand, data-snapshots, scripts, integrations, seo and so
// on) and every file at the root is skipped. Any path with a folder named "slack" anywhere in
// it is refused outright, so raw Slack capture never reaches the app even if it is nested.
//
// A page is not published when its frontmatter says publish: false, draft: true, private: true,
// visibility: private or status: draft. Templates (file names starting with "_") and generated index files (INDEX.md, or any file carrying
// the HQ generated marker) are skipped too.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const STAGING_REF = 'mnvcksbhbvypuiwozvct';
export const DEFAULT_ROOT = '/Users/mattgattozzi/Goodo Studios/hq/companies/goodo-studios/knowledge';
export const SECTIONS = ['Handbook', 'Playbooks', 'Clients', 'Insights'];
export const SECTION_BY_FOLDER = Object.freeze({
  company: 'Handbook',
  processes: 'Playbooks',
  clients: 'Clients',
  insights: 'Insights',
});
export const UNASSIGNED = 'Unassigned';
/** Frontmatter keys read for the last-reviewed date, in order of preference. */
export const REVIEW_KEYS = ['last_reviewed', '_last_reviewed', 'reviewed', 'last_updated', 'updated', '_last_revised'];
const GENERATED_MARKER = 'hq-generated-sha256';

/** Read the command line. Unknown flags are refused so a typo cannot slip through. */
export function parseArgs(argv) {
  const opts = { dryRun: false, allowProduction: false, overwriteEdited: false, help: false, root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--allow-production') opts.allowProduction = true;
    else if (arg === '--overwrite-edited') opts.overwriteEdited = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--root') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('--root needs a folder.');
      opts.root = value;
    } else if (arg.startsWith('--root=')) {
      opts.root = arg.slice('--root='.length);
      if (!opts.root) throw new Error('--root needs a folder.');
    } else throw new Error(`Unknown option "${arg}". Use --root, --dry-run, --allow-production, --overwrite-edited or --help.`);
  }
  return opts;
}

/** Refuse any target that is not the staging project unless --allow-production was passed. */
export function assertTarget(url, { allowProduction = false } = {}) {
  if (!url || typeof url !== 'string') throw new Error('Set TARGET_SUPABASE_URL.');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TARGET_SUPABASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') throw new Error('TARGET_SUPABASE_URL must use https.');
  if (!parsed.hostname.split('.').includes(STAGING_REF) && !allowProduction) {
    throw new Error(
      `Refusing to write to ${parsed.hostname}: it is not the staging project (${STAGING_REF}). ` +
        'Pass --allow-production only when you mean to publish to production.',
    );
  }
  return parsed.hostname;
}

/** Path with forward slashes, relative to the knowledge root. */
export function toPosix(relPath) {
  return relPath.split(path.sep).join('/').replace(/^\.\//, '');
}

export function hasSlackSegment(relPath) {
  return toPosix(relPath).split('/').some((s) => s.toLowerCase() === 'slack');
}

/** Section for a path, or the reason it is skipped. */
export function sectionFor(relPath) {
  const p = toPosix(relPath);
  if (hasSlackSegment(p)) return { skip: 'slack capture is never published' };
  const parts = p.split('/');
  if (parts.length < 2) return { skip: 'file at the knowledge root' };
  const section = SECTION_BY_FOLDER[parts[0]];
  if (!section) return { skip: `folder "${parts[0]}" is not published` };
  if (!p.toLowerCase().endsWith('.md')) return { skip: 'not a markdown file' };
  if (parts[parts.length - 1].startsWith('_')) return { skip: 'template file' };
  return { section };
}

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v;
}

function scalar(raw) {
  const v = raw.replace(/\s+#.*$/, '').trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((s) => unquote(s)).filter((s) => s.length > 0);
  }
  const u = unquote(v);
  if (u === 'true') return true;
  if (u === 'false') return false;
  if (u === '' || u === '~' || u === 'null') return null;
  return u;
}

/**
 * Small frontmatter reader for the simple "key: value" YAML these files use. Handles quoted
 * values, inline [a, b] lists and "- item" lists under a key. Nested maps are ignored. Text
 * without a closing --- line is treated as having no frontmatter.
 */
export function parseFrontmatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { data: {}, body: src };
  const end = src.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: src };
  const after = src.indexOf('\n', end + 4);
  const block = src.slice(4, end);
  const body = after === -1 ? '' : src.slice(after + 1);
  const data = {};
  let listKey = null;
  for (const line of block.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(unquote(item[1]));
      continue;
    }
    if (/^\s/.test(line)) continue; // nested map: not used for publishing
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (raw.trim() === '') {
      data[key] = null;
      listKey = key;
    } else {
      data[key] = scalar(raw);
      listKey = null;
    }
  }
  return { data, body };
}

/** Why a page is held back by its own frontmatter, or null when it can be published. */
export function unpublishedReason(data) {
  const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
  if (data.publish === false || lower(data.publish) === 'false' || lower(data.publish) === 'no') return 'marked publish: false';
  if (data.draft === true || lower(data.draft) === 'true') return 'marked draft';
  if (data.private === true || lower(data.private) === 'true') return 'marked private';
  if (lower(data.visibility) === 'private') return 'marked private';
  if (lower(data.status) === 'draft') return 'status is draft';
  return null;
}

export function slugify(value) {
  const s = String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'page';
}

/** Slug from the path inside the section folder: processes/sales/discovery.md -> sales-discovery. */
export function slugForPath(relPath) {
  const parts = toPosix(relPath).split('/').slice(1);
  const last = parts.pop().replace(/\.md$/i, '');
  if (/^(readme|index)$/i.test(last) && parts.length) return slugify(parts.join('-'));
  return slugify([...parts, last].join('-'));
}

function firstHeading(body) {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  return m ? m[1].trim() : null;
}

function titleFromFile(relPath) {
  const parts = toPosix(relPath).split('/');
  let name = parts.pop().replace(/\.md$/i, '');
  if (/^(readme|index)$/i.test(name) && parts.length > 1) name = parts.pop();
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Last reviewed date and where it came from: a frontmatter key, or 'file' for the change time. */
export function lastReviewedFor(data, mtime) {
  for (const key of REVIEW_KEYS) {
    const date = isoDate(data[key]);
    if (date) return { date, source: key };
  }
  const fromFile = mtime == null ? null : isoDate(new Date(mtime));
  return { date: fromFile, source: fromFile ? 'file' : null };
}

function ownerFor(data) {
  const raw = data.owner;
  const value = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw.trim() : '';
  return value ? { owner: value, missing: false } : { owner: UNASSIGNED, missing: true };
}

// A space is kept inside a path when the next word still has a slash ("Goodo Studios/hq").
const LOCAL_PATH = /(?:file:\/\/)?(?:\/Users\/|\/home\/|~\/)(?:[^\s)`'"<>\]]| (?=[^\s)`'"<>\]/]*\/))*/g;

/** Last folder or file name of a local path, so the text still reads sensibly. */
function shortName(localPath) {
  const parts = localPath.replace(/^file:\/\//, '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'local file';
}

/** Turn a published page into its in-app link target. */
export function brainHref(section, slug) {
  return `#brain/${section.toLowerCase()}/${slug}`;
}

/**
 * Strip the HQ-only bits from a page body:
 *  - links to web pages stay;
 *  - links to another published page become an in-app Brain link;
 *  - every other link that is not a web link (other HQ files, folders, local files) becomes its
 *    plain text;
 *  - absolute local paths in the text are cut down to their last name.
 * `published` maps a source path (relative to the knowledge root) to { section, slug }.
 */
export function stripHqBits(body, { relPath, published }) {
  const dir = path.posix.dirname(toPosix(relPath));
  const linked = body.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, bang, text, target) => {
    if (/^(https?:|mailto:)/i.test(target)) return whole;
    if (target.startsWith('#')) return text; // in-file anchors do not carry over
    if (bang) return text ? `${text}` : '';
    const clean = decodeURIComponent(target.split('#')[0]);
    if (!/^(\/|~|file:)/.test(clean)) {
      const resolved = path.posix.normalize(path.posix.join(dir, clean));
      const hit = published.get(resolved);
      if (hit) return `[${text}](${brainHref(hit.section, hit.slug)})`;
    }
    return text;
  });
  return linked.replace(LOCAL_PATH, (m) => shortName(m));
}

export function contentHash(page) {
  const stable = JSON.stringify([page.section, page.slug, page.title, page.body_md, page.owner, page.last_reviewed, page.last_reviewed_source]);
  return createHash('sha256').update(stable).digest('hex');
}

/**
 * Turn the knowledge files into pages. `files` is [{ relPath, text, mtime }].
 * Returns { pages, skipped, notes } where skipped is [{ path, reason }] and notes lists pages
 * published with a fallback owner or date.
 */
export function buildPages(files) {
  const skipped = [];
  const candidates = [];
  for (const f of files) {
    const relPath = toPosix(f.relPath);
    const where = sectionFor(relPath);
    if (where.skip) {
      skipped.push({ path: relPath, reason: where.skip });
      continue;
    }
    if (/(^|\/)INDEX\.md$/.test(relPath) || String(f.text).includes(GENERATED_MARKER)) {
      skipped.push({ path: relPath, reason: 'generated index' });
      continue;
    }
    const { data, body } = parseFrontmatter(f.text);
    const held = unpublishedReason(data);
    if (held) {
      skipped.push({ path: relPath, reason: held });
      continue;
    }
    candidates.push({ relPath, data, body, mtime: f.mtime, section: where.section });
  }

  // Slugs are unique per section; a clash gets -2, -3 and so on, in path order.
  candidates.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const taken = new Set();
  const published = new Map();
  for (const c of candidates) {
    const base = slugForPath(c.relPath);
    let slug = base;
    for (let n = 2; taken.has(`${c.section}/${slug}`); n++) slug = `${base}-${n}`;
    taken.add(`${c.section}/${slug}`);
    c.slug = slug;
    published.set(c.relPath, { section: c.section, slug });
  }

  const pages = [];
  const notes = [];
  for (const c of candidates) {
    const title = (typeof c.data.title === 'string' && c.data.title.trim()) || firstHeading(c.body) || titleFromFile(c.relPath);
    const { owner, missing } = ownerFor(c.data);
    const reviewed = lastReviewedFor(c.data, c.mtime);
    const page = {
      section: c.section,
      slug: c.slug,
      title,
      body_md: stripHqBits(c.body, { relPath: c.relPath, published }).trim(),
      owner,
      last_reviewed: reviewed.date,
      last_reviewed_source: reviewed.source,
      source_path: c.relPath,
    };
    page.content_hash = contentHash(page);
    pages.push(page);
    if (missing) notes.push({ path: c.relPath, note: 'no owner, shown as Unassigned' });
    if (reviewed.source === 'file') notes.push({ path: c.relPath, note: 'no review date, used the file change date' });
    if (!reviewed.date) notes.push({ path: c.relPath, note: 'no review date' });
  }
  return { pages, skipped, notes };
}

/**
 * Compare this run with what the app holds. `existing` is [{ source_path, content_hash,
 * edited_in_app }]. Returns the pages to add and update, the count unchanged, the source paths to
 * remove and `kept`, the source paths of pages edited in the app.
 *
 * App edits win: a page with edited_in_app is never updated or removed (it lands in `kept`), unless
 * `overwriteEdited` is set, in which case HQ wins again: it is updated to the HQ text whatever its
 * hash (so the edited_in_app marker is cleared by the write) or removed if its file is gone.
 */
export function diffPages(existing, pages, { overwriteEdited = false } = {}) {
  const have = new Map(existing.map((r) => [r.source_path, r]));
  const seen = new Set();
  const add = [];
  const update = [];
  const kept = [];
  let unchanged = 0;
  for (const p of pages) {
    seen.add(p.source_path);
    const row = have.get(p.source_path);
    if (!row) add.push(p);
    else if (row.edited_in_app && !overwriteEdited) kept.push(p.source_path);
    else if (row.edited_in_app || row.content_hash !== p.content_hash) update.push(p);
    else unchanged++;
  }
  const remove = [];
  for (const r of existing) {
    if (seen.has(r.source_path)) continue;
    if (r.edited_in_app && !overwriteEdited) kept.push(r.source_path);
    else remove.push(r.source_path);
  }
  return { add, update, unchanged, remove, kept };
}

/**
 * Read every markdown file under the published folders of the knowledge root. Slack folders,
 * dot folders and symbolic links are never entered. Skipped top-level folders are reported once.
 */
export async function readKnowledge(root) {
  const files = [];
  const skipped = [];
  async function walk(dir, rel) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        skipped.push({ path: childRel, reason: 'symbolic link' });
        continue;
      }
      if (e.isDirectory()) {
        if (e.name.toLowerCase() === 'slack') {
          skipped.push({ path: `${childRel}/`, reason: 'slack capture is never published' });
          continue;
        }
        if (!rel && !SECTION_BY_FOLDER[e.name]) {
          skipped.push({ path: `${childRel}/`, reason: `folder "${e.name}" is not published` });
          continue;
        }
        await walk(path.join(dir, e.name), childRel);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const full = path.join(dir, e.name);
        const [text, info] = await Promise.all([readFile(full, 'utf8'), stat(full)]);
        files.push({ relPath: childRel, text, mtime: info.mtimeMs });
      }
    }
  }
  await walk(root, '');
  return { files, skipped };
}

/** Group skip reasons for the summary: [[reason, count]], most common first. */
export function summariseSkips(skipped) {
  const counts = new Map();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * OS-016: the owners the app could not match to a staff login, from rematch_brain_page_owners
 * ([{ owner, pages }]). Lines for the summary, sorted by owner.
 */
export function unmatchedOwnerLines(rows) {
  return [...(rows ?? [])]
    .sort((a, b) => a.owner.localeCompare(b.owner))
    .map((r) => `  ${r.owner} (${r.pages} ${r.pages === 1 ? 'page' : 'pages'})`);
}

/**
 * OS-016: accepted fixes still to apply in HQ. A fix counts as applied once its page was
 * published with a different content hash, or the page is gone. `fixes` are brain_page_corrections
 * rows with their brain_page_correction_reviews; `pages` are [{ id, content_hash }] after this run.
 */
export function pendingFixes(fixes, pages) {
  const hashById = new Map((pages ?? []).map((p) => [p.id, p.content_hash]));
  return (fixes ?? [])
    .filter((f) => {
      const raw = f.brain_page_correction_reviews;
      const reviews = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return reviews.some((r) => r.decision === 'accepted') && hashById.get(f.brain_page_id) === f.page_content_hash;
    })
    .sort((a, b) => a.source_path.localeCompare(b.source_path) || a.created_at.localeCompare(b.created_at));
}
