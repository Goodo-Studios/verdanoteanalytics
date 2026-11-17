// Client BIDs: staff page (consolidation step 6, "BID Builder: read-only BID viewer in
// Verdanote"). Staff pick a client and read its Brand Intelligence Document, with a section list
// and older versions. A BID is not edited in place. It arrives through the service-role import
// (migration 20261111020001) or staff add it by uploading a file or pasting text (migration
// 20261216570001, add_client_bid); either way a new BID is a new version. Clients read none of them.
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { EmptyState, ErrorState, LoadingState, PageHeader, PageShell, SelectField, TextareaField, TextField } from "@/components/page-kit";
import { fmtDate } from "@/lib/formatters";
import { useBusy } from "@/hooks/useBusy";
import { Button } from "@/components/ui/button";
import { FileChooser, OriginalFileLink } from "@/features/documents/DocumentUploadParts";
import { titleFromDocument } from "@/features/documents/model";
import { submitDocument } from "@/features/documents/upload";
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
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;

/** Add a BID version for the selected client from a file or pasted text. */
function AddBid({ clientSlug, hasBid, onAdded }: { clientSlug: string; hasBid: boolean; onAdded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { busy, run } = useBusy();
  const add = () => run(async () => {
    setError(null);
    setDone(false);
    const result = await submitDocument<string>({
      area: "bid",
      file,
      pastedText: text,
      failureText: "The BID could not be added.",
      call: async (body, stored) => {
        const { data, error: e } = await db.rpc("add_client_bid", {
          p_client_slug: clientSlug,
          p_title: title.trim() || titleFromDocument(file?.name ?? null, body, "Brand doc"),
          p_body_markdown: body,
          p_file_path: stored?.path ?? null,
          p_file_name: stored?.name ?? null,
          p_mime_type: stored?.mime ?? null,
          p_size_bytes: stored?.size ?? null,
        });
        return { data: (data as string | null) ?? null, error: e };
      },
    });
    if (!result.ok) return setError(result.message);
    setFile(null);
    setText("");
    setTitle("");
    setDone(true);
    onAdded();
  });
  return (
    <details open={!hasBid} className="rounded-lg border border-input bg-background p-4" data-testid="bid-add">
      <summary className="cursor-pointer text-sm font-medium">{hasBid ? "Add a new version of this BID" : "Add this client's BID"}</summary>
      <div className="mt-3 space-y-2">
        <FileChooser file={file} onFile={setFile} label="BID file" />
        <TextareaField label="BID text" hideLabel inputClassName="min-h-[120px]" placeholder="Or paste the BID text (Markdown)" value={text} onChange={(e) => setText(e.target.value)} />
        <TextField label="BID title" hideLabel placeholder="Title (optional, taken from the file when empty)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <p className="text-[12px] text-muted-foreground">A file is read as the BID text. For a PDF the text is not read, so paste it above if you want it shown here; the PDF stays available to open.</p>
        <Button size="sm" disabled={busy || (!file && !text.trim())} onClick={() => void add()}>Add BID</Button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {done ? <p role="status" className="text-sm text-muted-foreground">BID added.</p> : null}
      </div>
    </details>
  );
}

export default function BidViewerPage() {
  const [summaries, setSummaries] = useState<BidSummary[] | null>(null);
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const clientSlug = useSelectedClientSlug();
  const [bidId, setBidId] = useState("");
  const [bid, setBid] = useState<Bid | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummaries = useCallback(() => {
    void db.from("client_bids").select(BID_LIST_SELECT).order("version", { ascending: false }).limit(1000).then(({ data, error: e }) => {
      if (e) {
        setError("Client BIDs could not load.");
        setSummaries((prev) => prev ?? []);
        return;
      }
      setError(null);
      setSummaries((data ?? []) as BidSummary[]);
    });
  }, []);
  useEffect(() => loadSummaries(), [loadSummaries]);

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
    <PageShell data-testid="bid-viewer">
      <PageHeader title="Client BIDs" description="Each client's Brand Intelligence Document. Upload a file or paste text to add one; each upload becomes the next version." />
      <div className="grid gap-2 sm:grid-cols-2">
        {!clientSlug ? <div className="sm:col-span-2"><PickClientPrompt what="its BID" /></div> : null}
        <SelectField
          label="Version"
          hideLabel
          value={bidId}
          disabled={versions.length < 2}
          onChange={(e) => setBidId(e.target.value)}
          options={versions.map((v, i) => ({ value: v.id, label: `Version ${v.version}${i === 0 ? " (latest)" : ""} · ${fmtDate(v.generated_at, "unknown")}` }))}
        />
      </div>
      {clientSlug && summaries ? <AddBid clientSlug={clientSlug} hasBid={versions.length > 0} onAdded={loadSummaries} /> : null}
      {error ? <ErrorState message={error} onRetry={() => window.location.reload()} /> : null}
      {summaries === null && !error ? <LoadingState label="Loading client BIDs" /> : null}
      {clientSlug && summaries && summaries.length > 0 && versions.length === 0 && !error ? <EmptyState title="This client has no BID loaded yet." /> : null}
      {summaries && summaries.length === 0 && !error ? <EmptyState title="No client BIDs have been loaded yet." /> : null}
      {bid ? (
        <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
          <nav aria-label="BID sections" className="space-y-1 text-sm lg:sticky lg:top-4 lg:self-start">
            {sections.filter((s) => s.heading).map((s) => (
              <a key={s.anchor} href={`#${s.anchor}`} className="block truncate text-muted-foreground hover:text-foreground">{s.heading}</a>
            ))}
          </nav>
          <article aria-label={`BID ${bid.title}`} className="space-y-6">
            <div className="space-y-2 rounded border border-input bg-muted/40 p-3 text-[12px] text-muted-foreground">
              <p data-testid="bid-meta">{bid.title} · version {bid.version} · generated {fmtDate(bid.generated_at, "unknown")} · loaded {fmtDate(bid.imported_at, "unknown")} · {originLabel(bid)}</p>
              <OriginalFileLink area="bid" targetId={bid.id} />
            </div>
            {sections.map((s) => (
              <section key={s.anchor} id={s.anchor} aria-label={s.heading || "Introduction"} className="prose">
                {s.heading ? <h2>{s.heading}</h2> : null}
                <ReactMarkdown>{s.body}</ReactMarkdown>
              </section>
            ))}
          </article>
        </div>
      ) : null}
    </PageShell>
  );
}
