// Meeting recaps: staff page (consolidation step 4a, port of the Goodo OS page
// src/pages/staff/MeetingRecaps.tsx). A staff member names a Fireflies transcript
// and a client; the meeting-recaps function prepares a recap from the clean
// excerpts only. Each decision and action is confirmed or rejected by a person
// against the exact item shown; questions stay open. Nothing is sent to ClickUp,
// Slack or the client.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { edgeFunctionError } from "@/lib/edgeFunctionError";
import {
  ACTION_LABEL,
  dateLabel,
  KIND_LABEL,
  missingLabel,
  type Recap,
  type RecapItem,
  reviewable,
  STATUS_LABEL,
  toRecaps,
} from "./model";

const FN = "meeting-recaps";
const SELECT = "*, meeting_recap_items(*, meeting_recap_reviews(*))";
const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

interface ClientOption {
  slug: string;
  name: string;
}
interface ClientsReader {
  from(table: "clients"): { select(columns: string): { order(column: string): PromiseLike<{ data: unknown; error: unknown }> } };
}

function ItemCard({ item, onReviewed }: { item: RecapItem; onReviewed: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = async (decision: "confirmed" | "rejected") => {
    if (!note.trim()) {
      setError("Add a short note before recording a decision.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: insertError } = await supabase
      .from("meeting_recap_reviews")
      .insert({ item_id: item.id, decision, confirmed_item_hash: item.item_hash, note: note.trim() });
    setBusy(false);
    if (insertError) {
      setError(
        insertError.code === "40001" ? "This item changed since it was shown. Reload before reviewing."
          : insertError.code === "23505" ? "This item already has a review."
          : "The review could not be saved.",
      );
      return;
    }
    onReviewed();
  };
  const date = dateLabel(item);
  return (
    <li className="space-y-2 rounded border border-input p-3 text-sm" data-testid={`recap-item-${item.id}`}>
      <p>
        <span className="font-medium">{KIND_LABEL[item.kind]}:</span> {item.summary}
      </p>
      {item.citations.map((c) => (
        <blockquote key={`${c.excerpt_id}:${c.start}`} className="border-l-2 border-border pl-2 text-muted-foreground">
          "{c.quote}"{c.speaker ? ` (${c.speaker})` : ""}
        </blockquote>
      ))}
      {date ? <p className="text-muted-foreground">{date}</p> : null}
      {item.missing_information.length ? <p className="text-muted-foreground">Not said: {missingLabel(item.missing_information)}</p> : null}
      {item.proposed_action ? <p className="text-muted-foreground">{ACTION_LABEL[item.proposed_action]} (recorded only, nothing is sent)</p> : null}
      {item.review ? (
        <p className="font-medium">
          {item.review.decision === "confirmed" ? "Confirmed" : "Rejected"}: {item.review.note}
        </p>
      ) : reviewable(item) ? (
        <div className="space-y-2">
          <input aria-label="Review note" className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (checked against the call)" />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void review("confirmed")}>Confirm</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void review("rejected")}>Reject</Button>
          </div>
          {error ? <p role="alert" className="text-red-700">{error}</p> : null}
        </div>
      ) : (
        <p className="text-muted-foreground">Questions stay open.</p>
      )}
    </li>
  );
}

export default function MeetingRecapsPage() {
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [clientSlug, setClientSlug] = useState("");
  const [transcriptId, setTranscriptId] = useState("");
  const [recaps, setRecaps] = useState<Recap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      // clients (the one client list, step 3) is not in the generated types yet.
      const untyped = supabase as unknown as ClientsReader;
      const { data, error: e } = await untyped.from("clients").select("slug, name").order("name");
      if (e) setError("Clients could not load.");
      else setClients((data ?? []) as ClientOption[]);
    })();
  }, []);

  const loadRecaps = useCallback(async (slug: string) => {
    if (!slug) {
      setRecaps(null);
      return;
    }
    const { data, error: e } = await supabase
      .from("meeting_recaps")
      .select(SELECT)
      .eq("client_slug", slug)
      .order("created_at", { ascending: false })
      .limit(20);
    if (e) {
      setError("Recaps could not load.");
      setRecaps([]);
    } else setRecaps(toRecaps(data));
  }, []);

  useEffect(() => {
    void loadRecaps(clientSlug);
  }, [clientSlug, loadRecaps]);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: invokeError } = await supabase.functions.invoke(FN, { body: { client_slug: clientSlug, transcript_id: transcriptId.trim() } });
    setBusy(false);
    if (invokeError) {
      setError(await edgeFunctionError(invokeError, "The recap could not be prepared."));
      return;
    }
    setMessage(data?.status === "prepared" ? `Recap prepared with ${data.items} item${data.items === 1 ? "" : "s"}.` : data?.limitation ?? "Recap recorded.");
    setTranscriptId("");
    await loadRecaps(clientSlug);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" data-testid="meeting-recaps">
      <PageHeader title="Meeting recaps" description="Decisions, open questions and actions from a Fireflies call, each with the exact words said. A person confirms each one." />
      <section className="space-y-3 rounded-lg border border-input bg-background p-5">
        <label className="block space-y-1 text-sm">
          <span>Client</span>
          <select aria-label="Client" className={input} value={clientSlug} onChange={(e) => setClientSlug(e.target.value)}>
            <option value="">{clients ? "Select client" : "Loading clients..."}</option>
            {(clients ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Fireflies transcript id</span>
          <input aria-label="Fireflies transcript id" className={input} value={transcriptId} onChange={(e) => setTranscriptId(e.target.value)} placeholder="From the Fireflies meeting link" />
        </label>
        <p className="text-[12px] text-muted-foreground">Personnel, legal and financial parts of the call are withheld and never sent to the model.</p>
        <Button disabled={busy || !clientSlug || !/^[A-Za-z0-9_-]{1,200}$/.test(transcriptId.trim())} onClick={() => void prepare()}>
          {busy ? "Preparing..." : "Prepare recap"}
        </Button>
        {message ? <p role="status" className="text-sm">{message}</p> : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      </section>
      {recaps === null ? null : recaps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recaps for this client yet.</p>
      ) : (
        <ul className="space-y-4">
          {recaps.map((r) => (
            <li key={r.id} className="space-y-2 rounded-lg border border-input bg-background p-4">
              <p className="text-sm font-semibold">
                {STATUS_LABEL[r.status]} · transcript {r.transcript_id}
                {r.meeting_started_at ? ` · call on ${new Date(r.meeting_started_at).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}
              </p>
              {r.limitation ? <p className="text-sm text-muted-foreground">{r.limitation}</p> : null}
              {r.items.length ? (
                <ul className="space-y-2">
                  {r.items.map((i) => <ItemCard key={i.id} item={i} onReviewed={() => void loadRecaps(clientSlug)} />)}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
