// Brain (Goodo OS OS-014): the company brain, published from HQ knowledge by
// scripts/publish-brain.mjs. Four sections: Handbook, Playbooks, Clients and Insights. Pages are
// read only here; changes are made in HQ and published again. Staff only: the table's row
// rules give clients nothing, and this page shows nothing to a client either.
//
// OS-016: a page not reviewed in more than 90 days carries a calm "Needs review" tag. Any staff
// member can suggest a fix through the shared correction form; the page owner or a builder
// accepts or rejects it. Accepting does not edit the page (HQ is the source): it records the fix
// for the owner to apply in HQ, and it shows as applied once the page is published again.
//
// OS-026: headings carry anchors (brainAnchor) so a task can link straight to its playbook
// section (#anchor in the address scrolls there), and a question box answers from Brain pages.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, TextField } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/formatters";
import { BrainAsk } from "./BrainAsk";
import { CorrectionForm, type CorrectionInput } from "@/features/knowledge/CorrectionForm";
import { CLASS_LABEL, errorText } from "@/features/knowledge/model";
import {
  BRAIN_SECTIONS,
  brainAnchor,
  type BrainFix,
  type BrainListRow,
  type BrainPageRow,
  type BrainSection,
  canReviewFix,
  FIX_STATUS_LABEL,
  fixStatus,
  matchesSearch,
  NEEDS_REVIEW_DAYS,
  withoutRepeatedTitle,
  needsReview,
  parseBrainHref,
  SECTION_BLURB,
  sectionFromParam,
  toFixes,
} from "./model";

// brain_pages and the fix tables are not in the generated types yet.
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
const PAGE_COLUMNS = "id, section, slug, title, owner, owner_user_id, last_reviewed, body_md, published_at, content_hash, source_path";
const FIX_COLUMNS = "*, brain_page_correction_reviews(*)";

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

function FixRow({ fix, page, onChanged }: { fix: BrainFix; page: BrainPageRow; onChanged: () => void }) {
  const { user, isBuilder } = useAuth();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const status = fixStatus(fix, page.content_hash);
  const review = async (decision: "accepted" | "rejected") => {
    if (!reason.trim()) return setError("Add a reason before recording a decision.");
    setError(null);
    const { error: e } = await db.rpc("review_brain_page_correction", { p_correction_id: fix.id, p_decision: decision, p_reason: reason.trim() });
    if (e) return setError(errorText(e.code, "The decision could not be saved."));
    onChanged();
  };
  return (
    <li className="space-y-2 rounded border border-input p-3 text-sm" data-testid="brain-fix">
      <p className="font-medium">
        {CLASS_LABEL[fix.classification]} fix · <span data-testid="brain-fix-status">{FIX_STATUS_LABEL[status]}</span>
        <span className="font-normal text-muted-foreground"> · {fmtDate(fix.created_at)}</span>
      </p>
      <p className="text-muted-foreground">{fix.reason}</p>
      <p className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">{fix.proposed_body}</p>
      {fix.review ? <p className="text-muted-foreground">Decision: {fix.review.reason}</p> : null}
      {status === "accepted" ? (
        <p className="text-muted-foreground" data-testid="brain-fix-apply">Apply this in HQ ({fix.source_path}), then publish the Brain again.</p>
      ) : null}
      {canReviewFix(fix, page, user?.id, isBuilder) ? (
        <div className="space-y-2">
          <TextField label="Decision reason" hideLabel value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void review("accepted")}>Accept</Button>
            <Button size="sm" variant="outline" onClick={() => void review("rejected")}>Reject</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </li>
  );
}

function Fixes({ page }: { page: BrainPageRow }) {
  const [fixes, setFixes] = useState<BrainFix[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db.from("brain_page_corrections").select(FIX_COLUMNS).eq("brain_page_id", page.id).order("created_at", { ascending: false });
    if (error) setLoadError(true);
    else setFixes(toFixes(data));
  }, [page.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (input: CorrectionInput): Promise<string | null> => {
    const { error } = await db.rpc("submit_brain_page_correction", {
      p_page_id: page.id, p_content_hash: page.content_hash, p_proposed_body: input.text, p_reason: input.reason, p_classification: input.classification,
    });
    if (error) {
      return error.code === "40001" ? "This page was published again since you opened it. Reload and try again." : errorText(error.code, "The fix could not be saved.");
    }
    void load();
    return null;
  };

  return (
    <section aria-label="Suggested fixes" className="space-y-3 border-t border-input pt-3" data-testid="brain-fixes">
      {suggesting ? (
        <CorrectionForm
          heading="Suggest a fix"
          initialText={page.body_md}
          submitLabel="Send to the owner"
          sentMessage="Fix sent to the page owner."
          onSubmit={submit}
          onCancel={() => setSuggesting(false)}
        />
      ) : (
        <Button size="sm" variant="outline" onClick={() => setSuggesting(true)}>Suggest a fix</Button>
      )}
      {loadError ? <p className="text-sm text-muted-foreground">Suggested fixes could not load.</p> : null}
      {fixes?.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Suggested fixes</h3>
          <ul className="space-y-2">
            {fixes.map((f) => <FixRow key={f.id} fix={f} page={page} onChanged={() => void load()} />)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function PageView({ section, slug, onOpen }: { section: BrainSection; slug: string; onOpen: (section: BrainSection, slug: string) => void }) {
  const [page, setPage] = useState<BrainPageRow | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const { hash } = useLocation();

  useEffect(() => {
    let live = true;
    setPage(undefined);
    setError(false);
    void db.from("brain_pages").select(PAGE_COLUMNS).eq("section", section).eq("slug", slug).maybeSingle().then(({ data, error: e }) => {
      if (!live) return;
      if (e) setError(true);
      else setPage((data as BrainPageRow | null) ?? null);
    });
    return () => { live = false; };
  }, [section, slug]);

  // A link to a section of the page (#anchor) scrolls to that heading once the page is in.
  useEffect(() => {
    if (!page || !hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    el?.scrollIntoView?.({ block: "start" });
  }, [page, hash]);

  // Links between Brain pages stay in the app; web links open in a new tab. react-markdown
  // renders no raw HTML and drops unsafe link targets.
  const components = useMemo<Components>(() => {
    const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      function Heading({ children }: { children?: React.ReactNode }) {
        const text = textOf(children);
        return <Tag id={brainAnchor(text) || undefined}>{children}</Tag>;
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
  }, [onOpen]);

  if (error) return <ErrorState message="This page could not load." />;
  if (page === undefined) return <LoadingState label="Loading page" />;
  if (page === null) return <EmptyState title="This page is not in the Brain. It may have been removed in HQ." />;
  return (
    <article aria-label={page.title} className="space-y-6 rounded-card border border-input bg-card px-6 py-8 shadow-card sm:px-10 sm:py-10" data-testid="brain-page">
      <header className="mx-auto max-w-[68ch] space-y-2 border-b border-input pb-5">
        <h2 className="gos-page-title">{page.title}</h2>
        <Meta owner={page.owner} lastReviewed={page.last_reviewed} />
      </header>
      <div className="prose mx-auto" data-testid="brain-page-body">
        <ReactMarkdown components={components}>{withoutRepeatedTitle(page.body_md, page.title)}</ReactMarkdown>
      </div>
      <Fixes key={page.id} page={page} />
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

  const load = useCallback(async () => {
    const { data, error: e } = await db.from("brain_pages").select(LIST_COLUMNS).order("title");
    if (e) {
      setError("The Brain could not load.");
      setRows([]);
    } else setRows((data ?? []) as BrainListRow[]);
  }, []);

  useEffect(() => {
    if (staff) void load();
  }, [load, staff]);

  const open = useCallback((s: BrainSection, pageSlug: string | null) => {
    const next = new URLSearchParams(params);
    next.set("section", s.toLowerCase());
    if (pageSlug) next.set("page", pageSlug);
    else next.delete("page");
    setParams(next);
  }, [params, setParams]);
  const openPage = useCallback((s: BrainSection, pageSlug: string) => open(s, pageSlug), [open]);

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
      <PageHeader title="Brain" description="Goodo's handbook, playbooks, client notes and insights, published from HQ. To change a page, edit it in HQ and publish again, or suggest a fix to its owner." />
      <BrainAsk onOpen={openPage} />
      <nav aria-label="Brain sections" className="flex flex-wrap gap-1 border-b border-input">
        {BRAIN_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            aria-current={s === section ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${s === section ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`}
            onClick={() => open(s, null)}
          >
            {s}
            {rows ? <span className="text-muted-foreground"> {counts.get(s) ?? 0}</span> : null}
          </button>
        ))}
      </nav>

      {slug ? (
        <div className="space-y-3">
          <button type="button" className="text-sm underline" onClick={() => open(section, null)}>Back to {section}</button>
          <PageView section={section} slug={slug} onOpen={openPage} />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{SECTION_BLURB[section]}</p>
          <FilterBar search={{ value: query, onChange: setQuery, label: "Search the Brain", placeholder: "Search titles and owners" }} />
          {error ? <ErrorState message={error} onRetry={() => { setError(null); setRows(null); void load(); }} /> : null}
          {rows === null ? <LoadingState label="Loading the Brain" /> : null}
          {rows && !error && visible.length === 0 ? (
            <EmptyState title={query ? "Nothing matches." : `Nothing has been published to ${section} yet.`} />
          ) : null}
          {visible.length ? (
            <ul className="divide-y divide-input rounded-lg border border-input" data-testid="brain-list">
              {visible.map((r) => (
                <li key={r.id}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted/40" onClick={() => open(section, r.slug)}>
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
    </PageShell>
  );
}
