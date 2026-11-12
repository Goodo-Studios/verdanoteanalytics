// Brain (Goodo OS OS-014): the company brain, published from HQ knowledge by
// scripts/publish-brain.mjs. Four sections: Handbook, Playbooks, Clients and Insights. Pages are
// read only here; changes are made in HQ and published again. Staff only: the table's row
// rules give clients nothing, and this page shows nothing to a client either.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell } from "@/components/page-kit";
import { fmtDate } from "@/lib/formatters";
import {
  BRAIN_SECTIONS,
  type BrainListRow,
  type BrainPageRow,
  type BrainSection,
  isStale,
  matchesSearch,
  parseBrainHref,
  SECTION_BLURB,
  sectionFromParam,
  STALE_DAYS,
} from "./model";

// brain_pages is not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { message: string } | null;
}
interface Untyped {
  from(table: string): {
    select(columns: string): {
      order(column: string): PromiseLike<DbResult>;
      eq(column: string, value: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<DbResult> } };
    };
  };
}
const db = supabase as unknown as Untyped;
const LIST_COLUMNS = "id, section, slug, title, owner, last_reviewed";
const PAGE_COLUMNS = "id, section, slug, title, owner, last_reviewed, body_md, published_at";

function reviewedText(date: string | null): string {
  return date ? `Last reviewed ${fmtDate(date)}` : "Not reviewed yet";
}

function Meta({ owner, lastReviewed }: { owner: string; lastReviewed: string | null }) {
  return (
    <p className="text-[12px] text-muted-foreground" data-testid="brain-page-meta">
      <span data-testid="brain-owner">Owner: {owner}</span>
      {" · "}
      <span data-testid="brain-reviewed">{reviewedText(lastReviewed)}</span>
      {isStale(lastReviewed) ? <span className="italic"> · may be out of date</span> : null}
    </p>
  );
}

function PageView({ section, slug, onOpen }: { section: BrainSection; slug: string; onOpen: (section: BrainSection, slug: string) => void }) {
  const [page, setPage] = useState<BrainPageRow | null | undefined>(undefined);
  const [error, setError] = useState(false);

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

  // Links between Brain pages stay in the app; web links open in a new tab. react-markdown
  // renders no raw HTML and drops unsafe link targets.
  const components = useMemo<Components>(() => ({
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
  }), [onOpen]);

  if (error) return <ErrorState message="This page could not load." />;
  if (page === undefined) return <LoadingState label="Loading page" />;
  if (page === null) return <EmptyState title="This page is not in the Brain. It may have been removed in HQ." />;
  return (
    <article aria-label={page.title} className="space-y-3 rounded-lg border border-input bg-background p-4" data-testid="brain-page">
      <div>
        <h2 className="text-lg font-semibold">{page.title}</h2>
        <Meta owner={page.owner} lastReviewed={page.last_reviewed} />
      </div>
      <div className="prose prose-sm max-w-none dark:prose-invert" data-testid="brain-page-body">
        <ReactMarkdown components={components}>{page.body_md}</ReactMarkdown>
      </div>
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
      <PageHeader title="Brain" description="Goodo's handbook, playbooks, client notes and insights, published from HQ. To change a page, edit it in HQ and publish again." />
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
                      {isStale(r.last_reviewed) ? <span className="italic" title={`Not reviewed in the last ${STALE_DAYS} days`}> · may be out of date</span> : null}
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
