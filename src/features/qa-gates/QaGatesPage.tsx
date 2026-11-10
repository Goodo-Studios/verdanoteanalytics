// QA gates: staff page (consolidation step 4b, port of the Goodo OS pages
// QaInbox.tsx and QaGateReview.tsx). The inbox lists deliverables whose current
// revision is on its way to release. Opening one shows the version-bound release
// gate from the database (deliverable_release_status): client approval, team
// confirmation, open QA returns, and the strategist and QA signoffs by two
// different people. Staff confirm, sign off, return a revision to the strategist
// with feedback, resolve a return, and mark the revision final with its download
// link. Every write goes through a checked database function (migration
// 20261110120003); clients see none of it. Nothing is sent to an editor or to
// ClickUp from here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  blockerText,
  canSignOff,
  currentSignoffs,
  errorText,
  openReturns,
  type QaItem,
  type ReleaseStatus,
  SIGNOFF_LABEL,
  type SignoffKind,
  sortInbox,
  toQaItems,
} from "./model";

// The QA gate tables and functions are not in the generated types yet.
interface DbResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  order(column: string): Query;
}
interface Untyped {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}
const db = supabase as unknown as Untyped;
const SELECT =
  "*, engagements(client_slug, cycle_number), engagement_deliverable_revisions(revision, review_url), engagement_deliverable_qa_returns(*), engagement_deliverable_signoffs(*), engagement_deliverable_confirmations(revision)";
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function Gate({ item, onChanged }: { item: QaItem; onChanged: () => void }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<ReleaseStatus | null>(null);
  const [feedback, setFeedback] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const signoffs = currentSignoffs(item);
  const open = openReturns(item);

  useEffect(() => {
    void db.rpc("deliverable_release_status", { p_deliverable_id: item.id }).then(({ data, error: e }) => {
      if (e) setError(errorText(e.code, "The release gate could not load."));
      else setStatus(data as ReleaseStatus);
    });
  }, [item]);

  const call = async (name: string, args: Record<string, unknown>, fallback: string) => {
    setError(null);
    const { error: e } = await db.rpc(name, args);
    if (e) return setError(errorText(e.code, fallback));
    onChanged();
  };
  const base = { p_deliverable_id: item.id, p_revision: item.current_revision };
  const signoff = (kind: SignoffKind) => void call("record_deliverable_signoff", { ...base, p_signoff_kind: kind }, "The signoff could not be recorded.");

  return (
    <section aria-label={`Release gate for ${item.title}`} className="space-y-3 rounded-lg border border-input bg-background p-4 text-sm">
      <div>
        <h2 className="text-base font-semibold">{item.title} · revision {item.current_revision}</h2>
        {item.review_url ? <a className="underline" href={item.review_url} target="_blank" rel="noopener noreferrer">Open exact revision</a> : null}
      </div>
      {status ? (
        status.ready ? <p role="status" className="font-medium text-green-700">Ready to send.</p> : (
          <ul aria-label="Still missing" className="list-disc pl-5">
            {status.blockers.map((b) => <li key={b}>{blockerText(b)}</li>)}
          </ul>
        )
      ) : <p className="text-muted-foreground">Loading the release gate...</p>}

      <div className="flex flex-wrap gap-2">
        {!item.confirmed ? <Button size="sm" variant="outline" onClick={() => void call("confirm_deliverable_revision", base, "The revision could not be confirmed.")}>Confirm team review</Button> : null}
        {(Object.keys(SIGNOFF_LABEL) as SignoffKind[]).map((kind) =>
          canSignOff(item, kind, user?.id, signoffs) && !signoffs.some((s) => s.signoff_kind === kind) ? (
            <Button key={kind} size="sm" variant="outline" onClick={() => signoff(kind)}>Sign off: {SIGNOFF_LABEL[kind]}</Button>
          ) : null,
        )}
      </div>
      {signoffs.length ? <p className="text-muted-foreground">Signed off: {signoffs.map((s) => SIGNOFF_LABEL[s.signoff_kind]).join(", ")}</p> : null}

      {open.map((r) => (
        <div key={r.id} className="space-y-2 rounded border border-amber-300 p-2" data-testid={`return-${r.id}`}>
          <p>Returned to the strategist: {r.feedback}</p>
          <input aria-label="Resolution note" className={field} placeholder="What was fixed" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={!note.trim()} onClick={() => void call("resolve_deliverable_qa_return", { p_return_id: r.id, p_note: note.trim() }, "The return could not be resolved.")}>Resolve return</Button>
        </div>
      ))}

      <div className="space-y-2">
        <textarea aria-label="Return feedback" className={field} placeholder="What the strategist needs to fix on this exact revision" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!feedback.trim()} onClick={() => void call("return_deliverable_to_strategist", { ...base, p_feedback: feedback.trim() }, "The revision could not be returned.")}>Return to strategist</Button>
      </div>

      {status?.ready ? (
        <div className="flex flex-wrap gap-2">
          <input aria-label="Final download link" className={field} placeholder="Final download link (https://...)" value={link} onChange={(e) => setLink(e.target.value)} />
          <Button size="sm" disabled={!link.trim().startsWith("https://")} onClick={() => void call("mark_deliverable_final_ready", { ...base, p_final_download_url: link.trim() }, "The deliverable could not be released.")}>Mark final, ready to send</Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </section>
  );
}

export default function QaGatesPage() {
  const [items, setItems] = useState<QaItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await db.from("engagement_deliverables").select(SELECT).order("updated_at");
    if (e) {
      setError("The QA inbox could not load.");
      setItems([]);
    } else setItems(toQaItems(data));
  }, []);
  useEffect(() => void load(), [load]);

  const inbox = useMemo(() => sortInbox(items ?? []), [items]);
  const active = inbox.find((i) => i.id === selected) ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" data-testid="qa-gates">
      <PageHeader title="QA gates" description="Version-bound release checks for each deliverable: client approval, team confirmation, strategist and QA signoffs." />
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {items === null ? <p role="status" className="text-sm text-muted-foreground">Loading the QA inbox...</p> : null}
      {items && inbox.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting for QA.</p> : null}
      <ul className="space-y-1" aria-label="QA inbox">
        {inbox.map((i) => (
          <li key={i.id}>
            <button type="button" className={`w-full rounded border px-3 py-2 text-left text-sm ${i.id === selected ? "border-foreground" : "border-input"}`} onClick={() => setSelected(i.id)}>
              <span className="font-medium">{i.title}</span>
              <span className="text-muted-foreground"> · {i.client_slug}{i.cycle_number ? ` cycle ${i.cycle_number}` : ""} · revision {i.current_revision} · {i.stage.replace(/_/g, " ")}{openReturns(i).length ? " · return open" : ""}</span>
            </button>
          </li>
        ))}
      </ul>
      {active ? <Gate key={`${active.id}:${active.current_revision}:${active.stage}:${active.signoffs.length}:${active.returns.length}:${String(active.confirmed)}`} item={active} onChanged={() => void load()} /> : null}
    </div>
  );
}
