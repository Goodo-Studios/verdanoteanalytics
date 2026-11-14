// The pure parts of scripts/publish-brain.mjs (OS-014): command line and target check, folder
// to section mapping, the Slack deny, frontmatter fallbacks, draft skipping, link stripping and
// the add/update/unchanged/remove plan for a re-run.
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_ROOT,
  STAGING_REF,
  UNASSIGNED,
  assertTarget,
  buildPages,
  diffPages,
  lastReviewedFor,
  parseArgs,
  parseFrontmatter,
  readKnowledge,
  sectionFor,
  slugForPath,
  pendingFixes,
  stripHqBits,
  unmatchedOwnerLines,
  unpublishedReason,
} from "../../scripts/publish-brain-lib.mjs";

describe("OS-016 owner report and fixes to apply in HQ", () => {
  it("lists owners with no staff login, sorted, with a page count", () => {
    expect(unmatchedOwnerLines([{ owner: "Zed", pages: 2 }, { owner: "Ann Smith", pages: 1 }])).toEqual(["  Ann Smith (1 page)", "  Zed (2 pages)"]);
    expect(unmatchedOwnerLines([])).toEqual([]);
    expect(unmatchedOwnerLines(null)).toEqual([]);
  });

  const fix = (id: string, page: string, hash: string, decision: string | null, sp = `company/${page}.md`) => ({
    id, brain_page_id: page, source_path: sp, page_content_hash: hash, reason: `why ${id}`, created_at: `2026-11-0${id}T00:00:00Z`,
    brain_page_correction_reviews: decision ? [{ decision }] : [],
  });

  it("keeps accepted fixes whose page has not been published again", () => {
    const pages = [{ id: "a", content_hash: "h1" }, { id: "b", content_hash: "h2-new" }];
    const fixes = [
      fix("1", "a", "h1", "accepted"),
      fix("2", "a", "h1", "rejected"),
      fix("3", "a", "h1", null),
      fix("4", "b", "h2-old", "accepted"),
      fix("5", "gone", "h9", "accepted"),
      fix("6", "a", "h1", "accepted", "clients/a.md"),
    ];
    expect(pendingFixes(fixes, pages).map((f) => f.id)).toEqual(["6", "1"]);
  });

  it("reads a single review object as well as a list", () => {
    const one = { ...fix("1", "a", "h1", null), brain_page_correction_reviews: { decision: "accepted" } };
    expect(pendingFixes([one], [{ id: "a", content_hash: "h1" }])).toHaveLength(1);
    expect(pendingFixes(null, null)).toEqual([]);
  });
});

const fm = (fields: string, body = "# Heading\n\nText.") => `---\n${fields}\n---\n${body}\n`;
const MTIME = Date.UTC(2026, 9, 5, 12);

describe("command line and target", () => {
  it("reads the flags, the root and refuses unknown ones", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, allowProduction: false, overwriteEdited: false, help: false, root: DEFAULT_ROOT });
    expect(parseArgs(["--overwrite-edited"]).overwriteEdited).toBe(true);
    expect(parseArgs(["--dry-run", "--root", "/tmp/k"])).toMatchObject({ dryRun: true, root: "/tmp/k" });
    expect(parseArgs(["--root=/tmp/x"]).root).toBe("/tmp/x");
    expect(() => parseArgs(["--root"])).toThrow(/needs a folder/);
    expect(() => parseArgs(["--dryrun"])).toThrow(/Unknown option/);
  });

  it("allows staging and refuses another project without --allow-production", () => {
    expect(assertTarget(`https://${STAGING_REF}.supabase.co`)).toBe(`${STAGING_REF}.supabase.co`);
    expect(() => assertTarget("https://prodref.supabase.co")).toThrow(/not the staging project/);
    expect(assertTarget("https://prodref.supabase.co", { allowProduction: true })).toBe("prodref.supabase.co");
    expect(() => assertTarget(undefined)).toThrow(/Set TARGET_SUPABASE_URL/);
    expect(() => assertTarget(`http://${STAGING_REF}.supabase.co`)).toThrow(/https/);
  });
});

describe("folders to sections", () => {
  it("maps the four published folders", () => {
    expect(sectionFor("company/overview.md")).toEqual({ section: "Handbook" });
    expect(sectionFor("processes/sales/discovery.md")).toEqual({ section: "Playbooks" });
    expect(sectionFor("clients/glow.md")).toEqual({ section: "Clients" });
    expect(sectionFor("insights/hooks.md")).toEqual({ section: "Insights" });
  });

  it("skips other folders, root files, non-markdown and templates", () => {
    for (const p of ["archive/old.md", "brand/voice.md", "data-snapshots/x.md", "scripts/a.md", "integrations/b.md"]) {
      expect(sectionFor(p).skip).toMatch(/is not published/);
    }
    expect(sectionFor("INDEX.md").skip).toMatch(/root/);
    expect(sectionFor("company/deal-calculator.html").skip).toMatch(/not a markdown/);
    expect(sectionFor("clients/_template.md").skip).toMatch(/template/);
  });

  it("refuses any path with a slack folder, nested or not, in any case", () => {
    for (const p of ["slack/general.md", "company/slack/notes.md", "processes/sales/slack/x.md", "insights/Slack/y.md"]) {
      expect(sectionFor(p).skip).toBe("slack capture is never published");
    }
    expect(sectionFor("company/slack-etiquette.md")).toEqual({ section: "Handbook" });
  });

  it("makes slugs from the path inside the section", () => {
    expect(slugForPath("processes/sales/Discovery Call.md")).toBe("sales-discovery-call");
    expect(slugForPath("company/roles/README.md")).toBe("roles");
    expect(slugForPath("company/overview.md")).toBe("overview");
  });
});

describe("frontmatter", () => {
  it("reads simple values, quotes, inline and block lists", () => {
    const { data, body } = parseFrontmatter(fm('title: "Hook rules"\nowner: a@example.test\ntags: [a, b]\nrelates_to:\n  - x.md\n  - y.md\nmeta:\n  nested: 1\ndraft: false'));
    expect(data).toMatchObject({ title: "Hook rules", owner: "a@example.test", tags: ["a", "b"], relates_to: ["x.md", "y.md"], draft: false });
    expect(data.nested).toBeUndefined();
    expect(body.startsWith("# Heading")).toBe(true);
  });

  it("treats text without frontmatter, or without a closing line, as body only", () => {
    expect(parseFrontmatter("# Just text").data).toEqual({});
    expect(parseFrontmatter("---\nowner: x\n# no close").data).toEqual({});
  });

  it("holds back drafts and private pages", () => {
    expect(unpublishedReason({ publish: false })).toMatch(/publish: false/);
    expect(unpublishedReason({ draft: true })).toMatch(/draft/);
    expect(unpublishedReason({ status: "Draft" })).toMatch(/draft/);
    expect(unpublishedReason({ private: true })).toMatch(/private/);
    expect(unpublishedReason({ visibility: "private" })).toMatch(/private/);
    expect(unpublishedReason({ status: "active", draft: false })).toBeNull();
  });

  it("reads the review date from the first key present, else the file date", () => {
    expect(lastReviewedFor({ last_reviewed: "2026-08-01", updated: "2026-01-01" }, MTIME)).toEqual({ date: "2026-08-01", source: "last_reviewed" });
    expect(lastReviewedFor({ _last_reviewed: "2026-07-26" }, MTIME)).toEqual({ date: "2026-07-26", source: "_last_reviewed" });
    expect(lastReviewedFor({ reviewed: "2026-06-02" }, MTIME)).toEqual({ date: "2026-06-02", source: "reviewed" });
    expect(lastReviewedFor({ updated: "2026-05-17T10:00:00Z" }, MTIME)).toEqual({ date: "2026-05-17", source: "updated" });
    expect(lastReviewedFor({ last_reviewed: "soon", _last_synced: "2026-05-16" }, MTIME)).toEqual({ date: "2026-10-05", source: "file" });
    expect(lastReviewedFor({}, null)).toEqual({ date: null, source: null });
  });
});

describe("building pages", () => {
  const files = [
    { relPath: "company/decision-rights.md", text: fm("title: Decision rights\nowner: m@example.test\n_last_reviewed: 2026-08-01"), mtime: MTIME },
    { relPath: "processes/editor-workflow.md", text: fm("status: active", "# Editor workflow\n\nSteps."), mtime: MTIME },
    { relPath: "processes/plain-name.md", text: "No heading here.", mtime: MTIME },
    { relPath: "insights/draft-idea.md", text: fm("status: draft\nowner: x"), mtime: MTIME },
    { relPath: "clients/hidden.md", text: fm("publish: false"), mtime: MTIME },
    { relPath: "company/slack/raw.md", text: fm("owner: x"), mtime: MTIME },
    { relPath: "slack/channel.md", text: "chat", mtime: MTIME },
    { relPath: "company/INDEX.md", text: "# Index", mtime: MTIME },
    { relPath: "clients/generated.md", text: "<!-- hq-generated-sha256: abc -->", mtime: MTIME },
  ];

  it("publishes approved pages with title, owner and date fallbacks, and reports them", () => {
    const { pages, skipped, notes } = buildPages(files);
    expect(pages.map((p) => p.source_path)).toEqual(["company/decision-rights.md", "processes/editor-workflow.md", "processes/plain-name.md"]);
    const [rights, editor, plain] = pages;
    expect(rights).toMatchObject({ section: "Handbook", slug: "decision-rights", title: "Decision rights", owner: "m@example.test", last_reviewed: "2026-08-01", last_reviewed_source: "_last_reviewed" });
    expect(editor).toMatchObject({ section: "Playbooks", title: "Editor workflow", owner: UNASSIGNED, last_reviewed: "2026-10-05", last_reviewed_source: "file" });
    expect(plain.title).toBe("Plain name");
    expect(notes).toContainEqual({ path: "processes/editor-workflow.md", note: "no owner, shown as Unassigned" });
    expect(notes).toContainEqual({ path: "processes/editor-workflow.md", note: "no review date, used the file change date" });
    expect(skipped.map((s) => s.path).sort()).toEqual(["clients/generated.md", "clients/hidden.md", "company/INDEX.md", "company/slack/raw.md", "insights/draft-idea.md", "slack/channel.md"]);
    expect(pages.every((p) => !p.source_path.split("/").includes("slack"))).toBe(true);
  });

  it("gives a clashing slug a number", () => {
    const { pages } = buildPages([
      { relPath: "processes/sales/a.md", text: "# A" },
      { relPath: "processes/sales-a.md", text: "# B" },
    ]);
    expect(pages.map((p) => p.slug).sort()).toEqual(["sales-a", "sales-a-2"]);
  });

  it("gives the same page the same hash and a changed page a new one", () => {
    const a = buildPages([files[0]]).pages[0];
    const b = buildPages([files[0]]).pages[0];
    const c = buildPages([{ ...files[0], text: files[0].text.replace("Text.", "New text.") }]).pages[0];
    expect(a.content_hash).toBe(b.content_hash);
    expect(c.content_hash).not.toBe(a.content_hash);
  });
});

describe("stripping HQ-only bits", () => {
  const published = new Map([["processes/editor-workflow.md", { section: "Playbooks", slug: "editor-workflow" }]]);
  const strip = (body: string) => stripHqBits(body, { relPath: "company/overview.md", published });

  it("keeps web links and turns links to published pages into Brain links", () => {
    expect(strip("See [docs](https://example.test/a) and [mail](mailto:a@example.test).")).toBe("See [docs](https://example.test/a) and [mail](mailto:a@example.test).");
    expect(strip("Read [the workflow](../processes/editor-workflow.md#steps).")).toBe("Read [the workflow](#brain/playbooks/editor-workflow).");
  });

  it("turns links to unpublished files and local paths into plain text", () => {
    expect(strip("See [raw notes](../slack/general.md) and [cost](cost-structure.md).")).toBe("See raw notes and cost.");
    expect(strip("Open [it](/Users/someone/hq/companies/x/file.md) or [that](file:///Users/someone/a.md).")).toBe("Open it or that.");
    expect(strip("Saved in /Users/someone/Goodo Studios/hq/notes.md today")).toBe("Saved in notes.md today");
    expect(strip("Run `~/bin/tool.sh` first")).toBe("Run `tool.sh` first");
    expect(strip("![diagram](./img/flow.png)")).toBe("diagram");
  });
});

describe("re-running publish", () => {
  const { pages } = buildPages([
    { relPath: "company/a.md", text: "# A", mtime: MTIME },
    { relPath: "company/b.md", text: "# B", mtime: MTIME },
    { relPath: "company/c.md", text: "# C", mtime: MTIME },
  ]);

  it("adds new pages, updates changed ones, leaves unchanged ones and removes deleted ones", () => {
    const existing = [
      { source_path: "company/a.md", content_hash: pages[0].content_hash },
      { source_path: "company/b.md", content_hash: "old" },
      { source_path: "company/gone.md", content_hash: "x" },
    ];
    const plan = diffPages(existing, pages);
    expect(plan.add.map((p) => p.source_path)).toEqual(["company/c.md"]);
    expect(plan.update.map((p) => p.source_path)).toEqual(["company/b.md"]);
    expect(plan.unchanged).toBe(1);
    expect(plan.remove).toEqual(["company/gone.md"]);
  });

  it("keeps a page edited in the app: not updated and not removed", () => {
    const existing = [
      { source_path: "company/a.md", content_hash: "old", edited_in_app: true },
      { source_path: "company/b.md", content_hash: pages[1].content_hash, edited_in_app: true },
      { source_path: "company/gone.md", content_hash: "x", edited_in_app: true },
      { source_path: "company/gone2.md", content_hash: "x", edited_in_app: false },
    ];
    const plan = diffPages(existing, pages);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toBe(0);
    expect(plan.add.map((p) => p.source_path)).toEqual(["company/c.md"]);
    expect(plan.kept).toEqual(["company/a.md", "company/b.md", "company/gone.md"]);
    expect(plan.remove).toEqual(["company/gone2.md"]);
  });

  it("with overwriteEdited HQ wins again: edited pages are updated even with the same hash, or removed", () => {
    const existing = [
      { source_path: "company/a.md", content_hash: "old", edited_in_app: true },
      { source_path: "company/b.md", content_hash: pages[1].content_hash, edited_in_app: true },
      { source_path: "company/gone.md", content_hash: "x", edited_in_app: true },
    ];
    const plan = diffPages(existing, pages, { overwriteEdited: true });
    expect(plan.update.map((p) => p.source_path)).toEqual(["company/a.md", "company/b.md"]);
    expect(plan.kept).toEqual([]);
    expect(plan.remove).toEqual(["company/gone.md"]);
  });

  it("adds everything on a first run and removes everything when nothing is left", () => {
    expect(diffPages([], pages)).toMatchObject({ unchanged: 0, remove: [] });
    expect(diffPages([], pages).add).toHaveLength(3);
    expect(diffPages([{ source_path: "company/a.md", content_hash: "h" }], []).remove).toEqual(["company/a.md"]);
  });
});

describe("reading a knowledge folder", () => {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "brain-"));
    await mkdir(path.join(root, "company", "slack"), { recursive: true });
    await mkdir(path.join(root, "processes", "sales"), { recursive: true });
    await mkdir(path.join(root, "slack"), { recursive: true });
    await mkdir(path.join(root, "archive"), { recursive: true });
    await writeFile(path.join(root, "company", "overview.md"), "# Overview");
    await writeFile(path.join(root, "company", "slack", "dump.md"), "# Dump");
    await writeFile(path.join(root, "processes", "sales", "call.md"), "# Call");
    await writeFile(path.join(root, "slack", "general.md"), "# General");
    await writeFile(path.join(root, "archive", "old.md"), "# Old");
    await symlink(path.join(root, "slack"), path.join(root, "company", "linked"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads only the published folders and never enters slack folders or links", async () => {
    const { files, skipped } = await readKnowledge(root);
    expect(files.map((f) => f.relPath)).toEqual(["company/overview.md", "processes/sales/call.md"]);
    expect(skipped).toContainEqual({ path: "company/slack/", reason: "slack capture is never published" });
    expect(skipped).toContainEqual({ path: "slack/", reason: "slack capture is never published" });
    expect(skipped).toContainEqual({ path: "archive/", reason: 'folder "archive" is not published' });
    expect(skipped).toContainEqual({ path: "company/linked", reason: "symbolic link" });
  });
});
