// Approve and request changes, on a client card (phase 5b). The client answers a card in Client Review, can
// change that answer while the card is still there, and approves delivered work once. Wording is plain and
// warm. The panel only exists where the page passes `onDecide` (a real client login); the read-only views
// and the staff pages never mount it.
import { useContext, useState } from "react";
import { DecisionContext } from "@/components/client/decisionContext";
import { Button } from "@/components/ui/button";
import {
  MAX_DECISION_NOTE,
  currentDecision,
  decisionLine,
  decisionOptions,
  earlierDecisions,
  noteProblem,
  type DecisionKind,
} from "@/lib/clientDecisions";

export function DecisionPanel({ taskId, stage }: { taskId: string | null | undefined; stage: string }) {
  const ctx = useContext(DecisionContext);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);

  if (!ctx || !taskId) return null;
  const current = currentDecision(ctx.decisions, taskId);
  const earlier = earlierDecisions(ctx.decisions, taskId);
  const options = decisionOptions(stage, current);
  if (!options.approve && !options.requestChanges && !current && earlier.length === 0) return null;

  const send = async (decision: DecisionKind) => {
    const problem = noteProblem(decision, note);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ctx.onDecide({ taskId, decision, ...(decision === "changes_requested" ? { note: note.trim() } : {}) });
      setThanks(decision === "approved" ? "Thank you. We have your approval." : "Thank you. We have your note and will get on it.");
      setAsking(false);
      setEditing(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "We could not save that just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const showButtons = (current === null || editing) && (options.approve || options.requestChanges);

  return (
    <div className="mt-2 space-y-2" data-testid="decision-panel">
      {current && (
        <div data-testid="decision-current" data-decision={current.decision}>
          <p className="font-body text-[12px] text-foreground">{decisionLine(current)}</p>
          {current.note && <p className="mt-0.5 font-body text-[12px] text-muted-foreground">Your note: {current.note}</p>}
        </div>
      )}
      {thanks && (
        <p className="font-body text-[12px] text-green-700" role="status" data-testid="decision-thanks">
          {thanks}
        </p>
      )}

      {current && options.canChange && !editing && (
        <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(true); setThanks(null); }} data-testid="decision-change">
          Change my answer
        </Button>
      )}

      {showButtons && !asking && (
        <div className="flex flex-wrap gap-2">
          {options.approve && (
            <Button type="button" size="sm" disabled={busy} onClick={() => void send("approved")} data-testid="decision-approve">
              Approve
            </Button>
          )}
          {options.requestChanges && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setAsking(true); setThanks(null); }} data-testid="decision-request-changes">
              Request changes
            </Button>
          )}
          {editing && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setError(null); }}>
              Keep my answer
            </Button>
          )}
        </div>
      )}

      {asking && (
        <div className="space-y-1.5" data-testid="decision-form">
          <label className="block font-body text-[12px] text-foreground" htmlFor={`decision-note-${taskId}`}>
            What would you like changed?
          </label>
          <textarea
            id={`decision-note-${taskId}`}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_DECISION_NOTE))}
            maxLength={MAX_DECISION_NOTE}
            rows={4}
            className="w-full rounded-[6px] border border-input bg-background px-2 py-1.5 font-body text-[13px]"
            data-testid="decision-note"
          />
          <p className="font-body text-[11px] text-muted-foreground">{note.length} of {MAX_DECISION_NOTE} characters</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void send("changes_requested")} data-testid="decision-send-changes">
              Send changes
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setAsking(false); setError(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="font-body text-[12px] text-red-700" role="alert" data-testid="decision-error">
          {error}
        </p>
      )}

      {earlier.length > 0 && (
        <details className="font-body text-[11px] text-muted-foreground" data-testid="decision-history">
          <summary className="cursor-pointer">Earlier answers ({earlier.length})</summary>
          <ul className="mt-1 space-y-1">
            {earlier.map((d) => (
              <li key={d.id}>
                {decisionLine(d)}
                {d.note ? ` Note: ${d.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
