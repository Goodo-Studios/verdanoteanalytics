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
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, PageShell, TextField, useConfirm } from "@/components/page-kit";
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

const KIND_LABEL: Record<ApplicationKind, string> = { creators: "Creator applications", actors: "Actor applications" };

function summaryOf(a: Application): string {
  if ("categories" in a) return [a.location, a.categories.join(", ")].filter(Boolean).join(" · ");
  return [a.gender, a.age_range.join(", ")].filter(Boolean).join(" · ");
}

/**
 * `lockedKind` pins the page to one kind and hides the creator/actor switch. The Creators menu opens it on
 * creators and Production opens it on actors. Without it (the old address) the switch shows.
 */
export default function ApplicationsPage({ lockedKind }: { lockedKind?: ApplicationKind } = {}) {
  const prefix = useRolePrefix();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const kind = lockedKind ?? parseKind(params.get("kind"));
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
    const ok = await confirm({
      title: `Reject ${chosen.length} application${chosen.length === 1 ? "" : "s"}?`,
      description: "They are rejected with the reason you typed, and the reason is kept on each application.",
      actionLabel: "Reject",
    });
    if (!ok) return;
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
    <PageShell data-testid="applications-page">
      <PageHeader
        title={lockedKind ? KIND_LABEL[lockedKind] : "Applications"}
        description={lockedKind ? `Review ${lockedKind === "actors" ? "actor" : "creator"} applications. Approving adds the applicant to the roster.` : "Review creator and actor applications. Approving adds the applicant to the roster."}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(lockedKind ? [] : (["creators", "actors"] as const)).map((k) => (
          <Button key={k} type="button" variant={kind === k ? "secondary" : "outline"} size="sm" aria-pressed={kind === k} onClick={() => go({ kind: k })}>{KIND_LABEL[k]}</Button>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          Public form: <a href={APPLY_LINKS[kind]} target="_blank" rel="noopener noreferrer" className="underline">{APPLY_LINKS[kind]}</a>
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => copy(APPLY_LINKS[kind])}>Copy form link</Button>
      </div>
      <FilterBar search={{ value: search, onChange: setSearch, label: "Search applications", placeholder: "Search name, email, location" }}>
        <Button type="button" variant={status === "pending" ? "secondary" : "outline"} size="sm" className="h-10" aria-pressed={status === "pending"} onClick={() => go({ status: "pending" })}>Pending ({counts.pending})</Button>
        <Button type="button" variant={status === "rejected" ? "secondary" : "outline"} size="sm" className="h-10" aria-pressed={status === "rejected"} onClick={() => go({ status: "rejected" })}>Rejected ({counts.rejected})</Button>
        <span className="flex h-10 items-center text-xs text-muted-foreground">{counts.approved} approved, now on the <Link to={`${prefix}/${kind}`} className="ml-1 underline">{kind === "creators" ? "Creators" : "Actors"}</Link>&nbsp;page.</span>
      </FilterBar>

      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && (!rows ? <ErrorState message={error} onRetry={() => void load()} /> : <p role="alert" className="text-sm text-destructive">{error}</p>)}

      {status === "pending" && selected.size > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border bg-card p-3 text-sm">
          <span className="flex h-10 items-center">{selected.size} selected</span>
          <TextField label="Rejection reason" hideLabel className="min-w-[18rem]" placeholder="Reason, kept on each application" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="button" variant="outline" disabled={busy} onClick={() => void bulkReject()}>{busy ? "Rejecting..." : `Reject ${selected.size}`}</Button>
        </div>
      )}

      {!rows ? (
        error ? null : <LoadingState label="Loading applications" />
      ) : visible.length === 0 ? (
        <EmptyState title={status === "pending" ? "No applications waiting for review." : "No rejected applications."} />
      ) : (
        <ul className="divide-y rounded-card border bg-card">
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
      {dialog}
    </PageShell>
  );
}
