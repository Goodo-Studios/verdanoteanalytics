// Approval boards: staff page (consolidation step 5b, port of the staff side
// of the old dashboard's approval boards). Per brand: the live client link
// (copy, revoke), a new link with an expiry when none is live, the client's
// thumbs up and down with the name they typed, applying those decisions to the
// Creator pipeline, and past links.
//
// The page a client opens (/approve/<token>) is served by Verdanote and reads
// and writes this database, so a link made or revoked here works at once. The
// votes below refresh on their own while the page is open. Actor boards are
// the casting links, on the Casting page.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSelectedClientSlug } from "@/contexts/ClientSelectionContext";
import { PickClientPrompt } from "@/components/PickClientPrompt";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader, PageShell, TextField, useConfirm } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import { applyVotes, createBoard, loadBoards, loadLinkStats, loadVotes, revokeBoard } from "./approvalBoardsApi";
import { describeActivity, lastResponse, type LinkStat } from "@/features/public-links/linkStats";
import {
  activeBoard,
  approvalUrl,
  boardState,
  defaultExpiry,
  parseExpiry,
  splitVotes,
  voteCreatorName,
  votesPayload,
  type ApprovalBoard,
  type ApprovalVote,
} from "./approvalBoardsModel";
import { errorText, formatDay } from "./model";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "P0002" ? "A creator on this board is no longer on the client. Nothing was applied." : errorText(e.code, e.message || fallback);
  return e instanceof Error ? e.message : fallback;
}

function VoteList({ title, votes, prefix }: { title: string; votes: ApprovalVote[]; prefix: string }) {
  return (
    <section aria-label={title} className="flex-1 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">{title} ({votes.length})</h3>
      {votes.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">None yet.</p> : (
        <ul className="mt-1 text-sm">
          {votes.map((v) => (
            <li key={v.id} className="border-t py-1" data-testid={`vote-${v.id}`}>
              {v.creator_assignments ? <Link to={`${prefix}/creators/${v.creator_assignments.creator_id}`} className="underline">{voteCreatorName(v)}</Link> : voteCreatorName(v)}
              <span className="text-xs text-muted-foreground"> · {formatDay(v.voted_at)}{v.voted_by ? ` · ${v.voted_by} (name typed by the reviewer)` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ApprovalBoardsPage() {
  const prefix = useRolePrefix();
  // The client comes from the one switcher at the top of the app (or the client hub address).
  const brand = useSelectedClientSlug();
  const [now] = useState(() => new Date());
  const [brands, setBrands] = useState<BrandOption[] | null>(null);
  const [boards, setBoards] = useState<ApprovalBoard[] | null>(null);
  const [votes, setVotes] = useState<ApprovalVote[]>([]);
  const [stats, setStats] = useState<Record<string, LinkStat>>({});
  const [expiry, setExpiry] = useState(() => defaultExpiry(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    loadBrandsAndTeam().then((b) => setBrands(b.brands), (e) => setError(e instanceof Error ? e.message : "Could not load clients."));
  }, []);

  const load = useCallback(async () => {
    if (!brand) {
      setBoards(null);
      setVotes([]);
      return;
    }
    try {
      const b = await loadBoards(brand);
      setBoards(b);
      const live = activeBoard(b, new Date());
      setVotes(live ? await loadVotes(live.id) : []);
      setStats(await loadLinkStats(b.map((x) => x.id)).catch(() => ({})));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load approval boards.");
    }
  }, [brand]);
  useEffect(() => {
    setBoards(null);
    void load();
  }, [load]);

  // Votes arrive while staff watch: look again every 15 seconds while a link is live.
  const hasLive = !!boards && !!activeBoard(boards, new Date());
  useEffect(() => {
    if (!hasLive) return;
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, [hasLive, load]);

  const brandName = brands?.find((b) => b.slug === brand)?.name ?? brand;
  const live = boards ? activeBoard(boards, now) : null;
  const past = (boards ?? []).filter((b) => b.id !== live?.id);
  const responses = splitVotes(votes);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setError(messageOf(e, "The change could not be saved."));
    }
    setBusy(false);
    await load();
  };

  const create = () => {
    const at = parseExpiry(expiry, new Date());
    if (!at) {
      setError("Pick an expiry date in the future.");
      return;
    }
    void run(async () => {
      await createBoard(brand, at);
      return `New link created for ${brandName}.`;
    });
  };
  const revoke = async (b: ApprovalBoard) => {
    if (!(await confirm({ title: `Revoke the ${brandName} approval link?`, description: "It stops working, and a new one can be made after.", actionLabel: "Revoke" }))) return;
    void run(async () => {
      await revokeBoard(b.id);
      return "Link revoked.";
    });
  };
  const apply = async () => {
    const up = responses.approved.length;
    const down = responses.passed.length;
    if (!(await confirm({ title: `Apply the client's decisions for ${brandName}?`, description: `${up} move to Client Approved and ${down} to Declined in the Creator pipeline.`, actionLabel: "Apply", tone: "default" }))) return;
    void run(async () => {
      const n = await applyVotes(brand, votesPayload(votes));
      return `Applied ${n} decision${n === 1 ? "" : "s"}: ${up} approved, ${down} declined.`;
    });
  };
  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => setNotice("Link copied."), () => setNotice(`Copy the link: ${url}`));
  };

  return (
    <PageShell data-testid="approval-boards-page">
      <PageHeader title="Approval boards" description="Client links for approving shortlisted creators, and what each client decided." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {brand && <Link to={`${prefix}/talent/pipeline`} className="underline">Creator pipeline</Link>}
        {brand && <Link to={`${prefix}/clients/${encodeURIComponent(brand)}`} className="underline">Client page</Link>}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="old-dashboard-note">
        Clients open this link on Verdanote with no login. Revoke stops it at once, and answers show here as they come in.
      </p>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!brand ? <PickClientPrompt what="its approval link" /> : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !boards ? (
        <LoadingState label="Loading approval boards" />
      ) : (
        <>
          <section aria-label="Client link" className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">Client link</h2>
            {live ? (
              <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="live-link">
                <a href={approvalUrl(live.token)} target="_blank" rel="noopener noreferrer" className="break-all underline">{approvalUrl(live.token)}</a>
                <span className="text-xs text-muted-foreground">expires {formatDay(live.expires_at)}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => copy(approvalUrl(live.token))}>Copy link</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void revoke(live)}>Revoke</Button>
                <p className="w-full text-xs text-muted-foreground" data-testid="link-activity">{describeActivity(stats[live.id], lastResponse(votes), formatDay)}</p>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">No live link for {brandName}.</span>
                <TextField label="Expiry date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={create}>Create link</Button>
              </div>
            )}
          </section>

          {live && (
            <section aria-label="Client responses" className="space-y-2 rounded-lg border p-3">
              <h2 className="text-sm font-semibold">What {brandName} said</h2>
              {votes.length === 0 ? <p className="text-sm text-muted-foreground">No responses yet.</p> : (
                <>
                  <div className="flex flex-wrap gap-3">
                    <VoteList title="Approved" votes={responses.approved} prefix={prefix} />
                    <VoteList title="Passed on" votes={responses.passed} prefix={prefix} />
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void apply()}>Apply decisions</Button>
                </>
              )}
            </section>
          )}

          <section aria-label="Past links" className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">Past links ({past.length})</h2>
            {past.length === 0 ? <EmptyState className="mt-2 py-4" title="None." /> : (
              <ul className="mt-1">
                {past.map((b) => (
                  <li key={b.id} className="border-t py-1" data-testid={`past-${b.id}`}>
                    Made {formatDay(b.created_at)}, {boardState(b, now) === "revoked" ? "revoked" : `expired ${formatDay(b.expires_at)}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {dialog}
    </PageShell>
  );
}
