// Applications: staff page (consolidation step 5b, port of the old dashboard's
// Applications and Actor applications pages). The review queue for creator and
// actor applications, pending or rejected, newest first, with search and a
// bulk reject that takes one reason. Each row opens the application, where it
// is approved or rejected. An applicant whose email is already on the roster
// is flagged. Approved applications are on the Creators and Actors pages.
//
// The public application forms stay on the old dashboard; this page links to
// them so staff can copy the link.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError } from "./api";
import { loadApplications, rejectApplication, type RosterContact } from "./applicationsApi";
import {
  APPLY_LINKS,
  countByStatus,
  formatSubmitted,
  parseKind,
  parseQueueStatus,
  queue,
  reviewErrorText,
  rosterMatches,
  summarizeBulkReject,
  type Application,
  type ApplicationKind,
  type BulkOutcome,
  type QueueStatus,
} from "./applicationsModel";

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const KIND_LABEL: Record<ApplicationKind, string> = { creators: "Creator applications", actors: "Actor applications" };

function summaryOf(a: Application): string {
  if ("categories" in a) return [a.location, a.categories.join(", ")].filter(Boolean).join(" · ");
  return [a.gender, a.age_range.join(", ")].filter(Boolean).join(" · ");
}

export default function ApplicationsPage() {
  const prefix = useRolePrefix();
  const [params, setParams] = useSearchParams();
  const kind = parseKind(params.get("kind"));
  const status = parseQueueStatus(params.get("status"));
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Application[] | null>(null);
  const [roster, setRoster] = useState<RosterContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await loadApplications(kind);
      setRows(r.rows);
      setRoster(r.roster);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load applications.");
    }
  }, [kind]);
  useEffect(() => {
    setRows(null);
    setSelected(new Set());
    void load();
  }, [load]);

  const go = (next: { kind?: ApplicationKind; status?: QueueStatus }) => {
    const p = new URLSearchParams();
    const k = next.kind ?? kind;
    // Switching between creator and actor applications opens the pending queue.
    const s = next.status ?? (next.kind && next.kind !== kind ? "pending" : status);
    if (k !== "creators") p.set("kind", k);
    if (s !== "pending") p.set("status", s);
    setParams(p, { replace: true });
    setSelected(new Set());
    setNotice(null);
  };

  const counts = useMemo(() => countByStatus(rows ?? []), [rows]);
  const visible = useMemo(() => queue(rows ?? [], status, search), [rows, status, search]);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const bulkReject = async () => {
    const chosen = visible.filter((a) => selected.has(a.id));
    if (!chosen.length) return;
    if (!reason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    if (!window.confirm(`Reject ${chosen.length} application${chosen.length === 1 ? "" : "s"} with this reason?`)) return;
    setBusy(true);
    setError(null);
    const outcomes: BulkOutcome[] = [];
    for (const a of chosen) {
      try {
        await rejectApplication(kind, a.id, reason.trim());
        outcomes.push({ id: a.id, name: a.name, ok: true });
      } catch (e) {
        outcomes.push({ id: a.id, name: a.name, ok: false, error: e instanceof DashboardError ? reviewErrorText(e.code, e.message) : String(e) });
      }
    }
    setNotice(summarizeBulkReject(outcomes));
    setSelected(new Set());
    setReason("");
    setBusy(false);
    await load();
  };

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => setNotice("Form link copied."), () => setNotice(`Copy the link: ${url}`));
  };

  return (
    <div className="p-6 space-y-4" data-testid="applications-page">
      <PageHeader title="Applications" description="Review creator and actor applications. Approving adds the applicant to the roster." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["creators", "actors"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={`${CTRL} ${kind === k ? "bg-muted font-medium" : ""}`} onClick={() => go({ kind: k })}>{KIND_LABEL[k]}</button>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          Public form (old dashboard): <a href={APPLY_LINKS[kind]} target="_blank" rel="noopener noreferrer" className="underline">{APPLY_LINKS[kind]}</a>
        </span>
        <button type="button" className={CTRL} onClick={() => copy(APPLY_LINKS[kind])}>Copy form link</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" aria-pressed={status === "pending"} className={`${CTRL} ${status === "pending" ? "bg-muted font-medium" : ""}`} onClick={() => go({ status: "pending" })}>Pending ({counts.pending})</button>
        <button type="button" aria-pressed={status === "rejected"} className={`${CTRL} ${status === "rejected" ? "bg-muted font-medium" : ""}`} onClick={() => go({ status: "rejected" })}>Rejected ({counts.rejected})</button>
        <span className="text-xs text-muted-foreground">{counts.approved} approved, now on the <Link to={`${prefix}/${kind}`} className="underline">{kind === "creators" ? "Creators" : "Actors"}</Link> page.</span>
        <input aria-label="Search applications" placeholder="Search name, email, location" className={`${CTRL} ml-auto min-w-[14rem]`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {status === "pending" && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <span>{selected.size} selected</span>
          <input aria-label="Rejection reason" placeholder="Reason, kept on each application" className={`${CTRL} min-w-[18rem]`} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className={CTRL} disabled={busy} onClick={() => void bulkReject()}>{busy ? "Rejecting..." : `Reject ${selected.size}`}</button>
        </div>
      )}

      {!rows ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading applications...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{status === "pending" ? "No applications waiting for review." : "No rejected applications."}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {visible.map((a) => {
            const dupes = rosterMatches(a.email, roster);
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-3 p-3 text-sm" data-testid={`application-${a.id}`}>
                {status === "pending" && (
                  <input type="checkbox" aria-label={`Select ${a.name}`} checked={selected.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
                )}
                <div className="min-w-[14rem] flex-1">
                  <Link to={`${prefix}/applications/${kind}/${a.id}`} className="font-medium underline">{a.name}</Link>
                  <div className="text-xs text-muted-foreground">{a.email} · submitted {formatSubmitted(a.submitted_at)}</div>
                  <div className="text-xs">{summaryOf(a)}</div>
                  {status === "rejected" && a.review_notes && <div className="text-xs text-muted-foreground">Reason: {a.review_notes}</div>}
                </div>
                {dupes.length > 0 && (
                  <div className="text-xs">
                    Already on the roster:{" "}
                    {dupes.map((d) => <Link key={d.id} to={`${prefix}/${kind}/${d.id}`} className="mr-1 underline">{d.name}</Link>)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
