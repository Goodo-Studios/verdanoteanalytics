// Brain (Goodo OS OS-014): the company brain, published from HQ knowledge by
// scripts/publish-brain.mjs. Four sections: Handbook, Playbooks, Clients and Insights. Staff only:
// the table's row rules give clients nothing, and this page shows nothing to a client either.
//
// Staff edit a page directly with the shared document editor. Saving calls edit_brain_page
// (migration 20261207080001), which writes the page and marks it edited in the app; the next
// publish from HQ keeps such a page instead of overwriting it (see scripts/publish-brain.mjs).
// The older suggest-a-fix flow is no longer shown; its tables are kept.
//
// OS-016: a page not reviewed in more than 90 days carries a calm "Needs review" tag.
//
// OS-026: headings carry anchors (brainAnchor) so a task can link straight to its playbook
// section (#anchor in the address scrolls there), and a question box answers from Brain pages.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, SelectField, TextareaField, TextField, useConfirm } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/formatters";
import { BrainAsk } from "./BrainAsk";
import { DocumentEditor } from "@/features/knowledge/DocumentEditor";
import { errorText } from "@/features/knowledge/model";
import {
  BRAIN_SECTIONS,
  brainAnchor,
  type BrainListRow,
  type BrainPageRow,
  type BrainSection,
  matchesSearch,
  NEEDS_REVIEW_DAYS,
  withoutRepeatedTitle,
  needsReview,
  parseBrainHref,
  SECTION_BLURB,
  SECTION_LABEL,
  sectionFromParam,
} from "./model";
import { FileChooser, OriginalFileLink } from "@/features/documents/DocumentUploadParts";
import { titleFromDocument } from "@/features/documents/model";
import { submitDocument } from "@/features/documents/upload";
import { useBusy } from "@/hooks/useBusy";

// brain_pages and its functions are not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: string): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  maybeSingle(): PromiseLike<DbResult>;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const LIST_COLUMNS = "id, section, slug, title, owner, last_reviewed";
const PAGE_COLUMNS = "id, section, slug, title, owner, owner_user_id, last_reviewed, body_md, published_at, content_hash, source_path, updated_at, edited_in_app, edited_at";

/** Plain text of rendered markdown children, for heading anchors. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  return "";
}

function reviewedText(date: string | null): string {
  return date ? `Last reviewed ${fmtDate(date)}` : "Not reviewed yet";
}

/** Calm tag for a page past its review window. Not red: it asks for a look, nothing is broken. */
function NeedsReviewTag() {
  return (
    <span
      data-testid="brain-needs-review"
      title={`Not reviewed in the last ${NEEDS_REVIEW_DAYS} days`}
      className="ml-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 align-middle text-[11px] font-medium text-muted-foreground"
    >
      Needs review
    </span>
  );
}

function Meta({ owner, lastReviewed }: { owner: string; lastReviewed: string | null }) {
  return (
    <p className="text-[13px] text-muted-foreground" data-testid="brain-page-meta">
      <span data-testid="brain-owner">Owner: {owner}</span>
      {" · "}
      <span data-testid="brain-reviewed">{reviewedText(lastReviewed)}</span>
      {needsReview(lastReviewed) ? <NeedsReviewTag /> : null}
    </p>
  );
}

/** Staff upload a document into one of the four sections (playbooks especially): a file or pasted text. */
function UploadPage({ defaultSection, onAdded }: { defaultSection: BrainSection; onAdded: (section: BrainSection, slug: string) => void }) {
  const [sectionChoice, setSectionChoice] = useState<BrainSection | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const target = sectionChoice ?? defaultSection;
  const upload = () => run(async () => {
    setError(null);
    const result = await submitDocument<{ slug: string }>({
      area: "brain",
      file,
      pastedText: text,
      failureText: "The document could not be uploaded.",
      call: async (body, stored) => {
        const { data, error: e } = await db.rpc("upload_brain_page", {
          p_section: target,
          p_title: title.trim() || titleFromDocument(file?.name ?? null, body),
          p_body_md: body,
          p_owner: owner.trim() || null,
          p_file_path: stored?.path ?? null,
          p_file_name: stored?.name ?? null,
          p_mime_type: stored?.mime ?? null,
          p_size_bytes: stored?.size ?? null,
        });
        return { data: (data as { slug: string } | null) ?? null, error: e };
      },
    });
    if (!result.ok) return setError(result.message);
    setFile(null);
    setText("");
    setTitle("");
    setOwner("");
    onAdded(target, result.data.slug);
  });
  return (
    <details className="rounded-lg border border-input bg-background p-4" data-testid="brain-upload">
      <summary className="cursor-pointer text-sm font-medium">Upload a document</summary>
      <div className="mt-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <SelectField label="Upload section" hideLabel value={target} onChange={(e) => setSectionChoice(e.target.value as BrainSection)} options={BRAIN_SECTIONS.map((s) => ({ value: s, label: SECTION_LABEL[s] }))} />
          <TextField label="Upload owner" hideLabel placeholder="Owner (optional)" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <TextField label="Upload title" hideLabel placeholder="Title (optional, taken from the file when empty)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <FileChooser file={file} onFile={setFile} label="Document file" />
        <TextareaField label="Upload text" hideLabel inputClassName="min-h-[100px]" placeholder="Or paste the text" value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-[12px] text-muted-foreground">For a PDF the text is not read, so paste it above if you want it searchable; the PDF stays available to open. An uploaded page is kept when HQ publishes again.</p>
        <Button size="sm" disabled={busy || (!file && !text.trim())} onClick={() => void upload()}>Upload</Button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </details>
  );
}

function PageView({ section, slug, onOpen, onDirtyChange }: { section: BrainSection; slug: string; onOpen: (section: BrainSection, slug: string) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [page, setPage] = useState<BrainPageRow | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const { hash } = useLocation();

  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    setPage(undefined);
    setError(false);
    setEditing(false);
    void db.from("brain_pages").select(PAGE_COLUMNS).eq("section", section).eq("slug", slug).maybeSingle().then(({ data, error: e }) => {
      if (!live) return;
      if (e) setError(true);
      else setPage((data as BrainPageRow | null) ?? null);
    });
    return () => { live = false; };
  }, [section, slug]);

  const save = async (current: BrainPageRow, text: string): Promise<string | null> => {
    const { error: e } = await db.rpc("edit_brain_page", { p_page_id: current.id, p_body_md: text, p_expected_updated_at: current.updated_at });
    if (e) return errorText(e.code, "The page could not be saved.");
    // Read the page again so the new text, and the timestamp the next save needs, are on screen.
    const { data, error: readError } = await db.from("brain_pages").select(PAGE_COLUMNS).eq("section", section).eq("slug", slug).maybeSingle();
    if (readError || !data) return "Saved, but the page could not be reloaded. Reload it to keep editing.";
    setPage(data as BrainPageRow);
    setEditing(false);
    return null;
  };

  // A link to a section of the page (#anchor) scrolls to that heading once the page is in.
  useEffect(() => {
    if (!page || !hash) return;
    // A hand-edited or truncated address can hold a malformed escape (for example "%E0%A4%A"),
    // and decodeURIComponent throws on it. Fall back to the raw text instead of crashing the page.
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // keep the raw id
    }
    const el = id ? document.getElementById(id) : null;
    el?.scrollIntoView?.({ block: "start" });
  }, [page, hash]);

  // Links between Brain pages stay in the app; web links open in a new tab. react-markdown
  // renders no raw HTML and drops unsafe link targets.
  const bodyMd = page?.body_md;
  const components = useMemo<Components>(() => {
    // Two headings with the same text must not share an id (the second would never be reachable by
    // its link). The first keeps the plain anchor; later ones get -2, -3 and so on. The id is fixed
    // by the heading's place in the source, so a re-render of one heading keeps its id.
    void bodyMd; // a new page text starts the numbering again
    const used = new Map<string, number>();
    const byPlace = new Map<string, string>();
    const idFor = (place: string, text: string): string | undefined => {
      const known = byPlace.get(place);
      if (known !== undefined) return known || undefined;
      const base = brainAnchor(text);
      if (!base) {
        byPlace.set(place, "");
        return undefined;
      }
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      const id = count === 1 ? base : `${base}-${count}`;
      byPlace.set(place, id);
      return id;
    };
    const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      function Heading({ children, node }: { children?: React.ReactNode; node?: { position?: { start?: { offset?: number; line?: number; column?: number } } } }) {
        const text = textOf(children);
        const start = node?.position?.start;
        const place = start ? `${start.offset ?? `${start.line}:${start.column}`}` : `text:${text}`;
        return <Tag id={idFor(place, text)}>{children}</Tag>;
      };
    return {
    h1: heading("h1"), h2: heading("h2"), h3: heading("h3"), h4: heading("h4"), h5: heading("h5"), h6: heading("h6"),
    a: ({ href, children }) => {
      const target = parseBrainHref(href);
      if (target) {
        return (
          <a href={href} className="underline" onClick={(e) => { e.preventDefault(); onOpen(target.section, target.slug); }}>
            {children}
          </a>
        );
      }
      return <a href={href} className="underline" target="_blank" rel="noopener noreferrer">{children}</a>;
    },
    };
  }, [onOpen, bodyMd]);

  if (error) return <ErrorState message="This page could not load." />;
  if (page === undefined) return <LoadingState label="Loading page" />;
  if (page === null) return <EmptyState title="This page is not in the Brain. It may have been removed in HQ." />;
  return (
    <article aria-label={page.title} className="space-y-6 rounded-card border border-input bg-card px-6 py-8 shadow-card sm:px-10 sm:py-10" data-testid="brain-page">
      <header className="mx-auto max-w-[68ch] space-y-2 border-b border-input pb-5">
        <h2 className="gos-page-title">{page.title}</h2>
        <Meta owner={page.owner} lastReviewed={page.last_reviewed} />
        <OriginalFileLink area="brain" targetId={page.id} />
        {page.edited_in_app ? (
          <p className="text-[12px] text-muted-foreground" data-testid="brain-edited">
            Edited in the app{page.edited_at ? ` on ${fmtDate(page.edited_at)}` : ""}. Publishing from HQ keeps this text.
          </p>
        ) : null}
      </header>
      {editing ? (
        <div className="mx-auto max-w-[68ch]">
          <DocumentEditor key={page.updated_at} initialText={page.body_md} label="Page text" onSave={(text) => save(page, text)} onCancel={() => setEditing(false)} onDirtyChange={onDirtyChange} />
        </div>
      ) : (
        <>
          <div className="prose mx-auto" data-testid="brain-page-body">
            <ReactMarkdown components={components}>{withoutRepeatedTitle(page.body_md, page.title)}</ReactMarkdown>
          </div>
          <div className="mx-auto max-w-[68ch] border-t border-input pt-3">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit this page</Button>
          </div>
        </>
      )}
    </article>
  );
}

export default function BrainPage() {
  const { isBuilder, isEmployee } = useAuth();
  const staff = isBuilder || isEmployee;
  const [params, setParams] = useSearchParams();
  const section = sectionFromParam(params.get("section"));
  const slug = params.get("page");
  const [rows, setRows] = useState<BrainListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const dirty = useRef(false);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    const { data, error: e } = await db.from("brain_pages").select(LIST_COLUMNS).order("title");
    if (e) {
      // Keep the list already on screen; an empty one would hide every page.
      setError("The Brain could not load.");
      setRows((prev) => prev ?? []);
    } else {
      setError(null);
      setRows((data ?? []) as BrainListRow[]);
    }
  }, []);

  useEffect(() => {
    if (staff) void load();
  }, [load, staff]);

  const open = useCallback(async (s: BrainSection, pageSlug: string | null) => {
    // Leaving the page being edited would drop its unsaved text, so ask first.
    if (dirty.current) {
      const ok = await confirm({ title: "Discard your changes?", description: "You have unsaved edits to this page. Leaving it throws them away.", actionLabel: "Discard changes" });
      if (!ok) return;
      dirty.current = false;
    }
    const next = new URLSearchParams(params);
    next.set("section", s.toLowerCase());
    if (pageSlug) next.set("page", pageSlug);
    else next.delete("page");
    setParams(next);
  }, [params, setParams, confirm]);
  const openPage = useCallback((s: BrainSection, pageSlug: string) => { void open(s, pageSlug); }, [open]);

  const counts = useMemo(() => {
    const c = new Map<BrainSection, number>();
    for (const r of rows ?? []) c.set(r.section, (c.get(r.section) ?? 0) + 1);
    return c;
  }, [rows]);
  const visible = useMemo(() => (rows ?? []).filter((r) => r.section === section && matchesSearch(r, query)), [rows, section, query]);

  if (!staff) {
    return (
      <PageShell data-testid="brain">
        <EmptyState title="The Brain is for the Goodo team." />
      </PageShell>
    );
  }

  return (
    <PageShell data-testid="brain">
      <PageHeader title="Brain" description="Goodo's handbook, playbooks, client notes and insights, published from HQ. Open a page and press Edit to add to it or remove from it. Your change shows right away and is kept when HQ publishes again." />
      <BrainAsk onOpen={openPage} />
      <UploadPage defaultSection={section} onAdded={(s, newSlug) => { void load(); openPage(s, newSlug); }} />
      <nav aria-label="Brain sections" className="flex flex-wrap gap-1 border-b border-input">
        {BRAIN_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            aria-current={s === section ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${s === section ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`}
            onClick={() => void open(s, null)}
          >
            {SECTION_LABEL[s]}
            {rows ? <span className="text-muted-foreground"> {counts.get(s) ?? 0}</span> : null}
          </button>
        ))}
      </nav>

      {slug ? (
        <div className="space-y-3">
          <button type="button" className="text-sm underline" onClick={() => void open(section, null)}>Back to {SECTION_LABEL[section]}</button>
          <PageView section={section} slug={slug} onOpen={openPage} onDirtyChange={(d) => { dirty.current = d; }} />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{SECTION_BLURB[section]}</p>
          <FilterBar search={{ value: query, onChange: setQuery, label: "Search the Brain", placeholder: "Search titles and owners" }} />
          {error ? <ErrorState message={error} onRetry={() => { setError(null); void load(); }} /> : null}
          {rows === null ? <LoadingState label="Loading the Brain" /> : null}
          {rows && !error && visible.length === 0 ? (
            <EmptyState title={query ? "Nothing matches." : `Nothing is in ${SECTION_LABEL[section]} yet. Upload a document above, or publish from HQ.`} />
          ) : null}
          {visible.length ? (
            <ul className="divide-y divide-input rounded-lg border border-input" data-testid="brain-list">
              {visible.map((r) => (
                <li key={r.id}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted/40" onClick={() => void open(section, r.slug)}>
                    <span className="font-medium">{r.title}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {r.owner} · {reviewedText(r.last_reviewed)}
                      {needsReview(r.last_reviewed) ? <NeedsReviewTag /> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {dialog}
    </PageShell>
  );
}
