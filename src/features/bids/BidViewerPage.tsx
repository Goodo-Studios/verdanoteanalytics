// Client BIDs: read-only staff page (consolidation step 6, "BID Builder: read-only BID viewer
// in Verdanote"). Staff pick a client and read its finished Brand Intelligence Document as
// written by the BID Builder, with a section list and older versions. There is no editing:
// BIDs arrive only through the service-role import (migration 20261111020001), and clients
// read none of them.
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/formatters";
import {
  type Bid,
  BID_LIST_SELECT,
  BID_SELECT,
  type BidSummary,
  latestByClient,
  originLabel,
  splitSections,
} from "./model";

// client_bids is not in the generated types.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  limit(n: number): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
}
const db = supabase as unknown as Untyped;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export default function BidViewerPage() {
  const [summaries, setSummaries] = useState<BidSummary[] | null>(null);
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const clientSlug = useSelectedClientSlug();
  const [bidId, setBidId] = useState("");
  const [bid, setBid] = useState<Bid | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db.from("client_bids").select(BID_LIST_SELECT).order("version", { ascending: false }).limit(1000).then(({ data, error: e }) => {
      if (e) {
        setError("Client BIDs could not load.");
        setSummaries([]);
        return;
      }
      setSummaries((data ?? []) as BidSummary[]);
    });
  }, []);

  const byClient = useMemo(() => latestByClient(summaries ?? []), [summaries]);
  const versions = clientSlug ? byClient.get(clientSlug) ?? [] : [];
  // Show the newest version of the selected client's BID.
  useEffect(() => {
    setBidId(byClient.get(clientSlug)?.[0]?.id ?? "");
  }, [clientSlug, byClient]);

  useEffect(() => {
    setBid(null);
    if (!bidId) return;
    let live = true;
    void db.from("client_bids").select(BID_SELECT).eq("id", bidId).limit(1).then(({ data, error: e }) => {
      if (!live) return;
      if (e) return setError("This BID could not load.");
      setError(null);
      setBid((((data ?? []) as Bid[])[0]) ?? null);
    });
    return () => {
      live = false;
    };
  }, [bidId]);

  const sections = useMemo(() => (bid ? splitSections(bid.body_markdown) : []), [bid]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4" data-testid="bid-viewer">
      <PageHeader title="Client BIDs" description="Each client's Brand Intelligence Document from the BID Builder. Read only." />
      <div className="grid gap-2 sm:grid-cols-2">
        {!clientSlug ? <div className="sm:col-span-2"><PickClientPrompt what="its BID" /></div> : null}
        <select aria-label="Version" className={field} value={bidId} disabled={versions.length < 2} onChange={(e) => setBidId(e.target.value)}>
          {versions.map((v, i) => (
            <option key={v.id} value={v.id}>Version {v.version}{i === 0 ? " (latest)" : ""} · {fmtDate(v.generated_at, "unknown")}</option>
          ))}
        </select>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {clientSlug && summaries && summaries.length > 0 && versions.length === 0 && !error ? <p className="text-sm text-muted-foreground">This client has no BID loaded yet.</p> : null}
      {summaries && summaries.length === 0 && !error ? <p className="text-sm text-muted-foreground">No client BIDs have been loaded yet.</p> : null}
      {bid ? (
        <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
          <nav aria-label="BID sections" className="space-y-1 text-sm lg:sticky lg:top-4 lg:self-start">
            {sections.filter((s) => s.heading).map((s) => (
              <a key={s.anchor} href={`#${s.anchor}`} className="block truncate text-muted-foreground hover:text-foreground">{s.heading}</a>
            ))}
          </nav>
          <article aria-label={`BID ${bid.title}`} className="space-y-6">
            <div className="rounded border border-input bg-muted/40 p-3 text-[12px] text-muted-foreground" data-testid="bid-meta">
              {bid.title} · version {bid.version} · generated {fmtDate(bid.generated_at, "unknown")} · loaded {fmtDate(bid.imported_at, "unknown")} · {originLabel(bid)}
            </div>
            {sections.map((s) => (
              <section key={s.anchor} id={s.anchor} aria-label={s.heading || "Introduction"} className="prose prose-sm max-w-none dark:prose-invert">
                {s.heading ? <h2>{s.heading}</h2> : null}
                <ReactMarkdown>{s.body}</ReactMarkdown>
              </section>
            ))}
          </article>
        </div>
      ) : null}
    </div>
  );
}
