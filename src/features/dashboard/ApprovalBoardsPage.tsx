// Approval boards: staff page (consolidation step 5b, port of the staff side
// of the old dashboard's approval boards). Per brand: the live client link
// (copy, revoke), a new link with an expiry when none is live, the client's
// thumbs up and down with the name they typed, applying those decisions to the
// Creator pipeline, and past links.
//
// The page a client opens (/approve/<token>) stays on the old dashboard and
// reads the old dashboard's database until the release, so a link made or
// revoked here takes effect for clients only once the release points that page
// at this database. The page says so. Actor boards are the casting links and
// move with step 5c.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError, loadBrandsAndTeam, type BrandOption } from "./api";
import { applyVotes, createBoard, loadBoards, loadVotes, revokeBoard } from "./approvalBoardsApi";
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

const CTRL = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof DashboardError) return e.code === "P0002" ? "A creator on this board is no longer on the brand. Nothing was applied." : errorText(e.code, e.message || fallback);
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
  const [params, setParams] = useSearchParams();
  const brand = params.get("brand") ?? "";
  const [now] = useState(() => new Date());
  const [brands, setBrands] = useState<BrandOption[] | null>(null);
  const [boards, setBoards] = useState<ApprovalBoard[] | null>(null);
  const [votes, setVotes] = useState<ApprovalVote[]>([]);
  const [expiry, setExpiry] = useState(() => defaultExpiry(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadBrandsAndTeam().then((b) => setBrands(b.brands), (e) => setError(e instanceof Error ? e.message : "Could not load brands."));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load approval boards.");
    }
  }, [brand]);
  useEffect(() => {
    setBoards(null);
    void load();
  }, [load]);

  const creatorBrands = useMemo(() => (brands ?? []).filter((b) => b.does_creators && (b.active || b.slug === brand)), [brands, brand]);
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
  const revoke = (b: ApprovalBoard) => {
    if (!window.confirm(`Revoke the ${brandName} approval link? It stops working, and a new one can be made after.`)) return;
    void run(async () => {
      await revokeBoard(b.id);
      return "Link revoked.";
    });
  };
  const apply = () => {
    const up = responses.approved.length;
    const down = responses.passed.length;
    if (!window.confirm(`Apply the client's decisions for ${brandName}? ${up} move to Client Approved and ${down} to Declined in the Creator pipeline.`)) return;
    void run(async () => {
      const n = await applyVotes(brand, votesPayload(votes));
      return `Applied ${n} decision${n === 1 ? "" : "s"}: ${up} approved, ${down} declined.`;
    });
  };
  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => setNotice("Link copied."), () => setNotice(`Copy the link: ${url}`));
  };

  return (
    <div className="p-6 space-y-4" data-testid="approval-boards-page">
      <PageHeader title="Approval boards" description="Client links for approving shortlisted creators, and what each client decided." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Brand" className={CTRL} value={brand} onChange={(e) => { setParams(e.target.value ? { brand: e.target.value } : {}, { replace: true }); setNotice(null); setError(null); }}>
          <option value="">Choose a brand</option>
          {creatorBrands.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </select>
        {brand && <Link to={`${prefix}/creator-pipeline?brand=${encodeURIComponent(brand)}`} className="underline">Creator pipeline</Link>}
        {brand && <Link to={`${prefix}/clients/${encodeURIComponent(brand)}`} className="underline">Client page</Link>}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="old-dashboard-note">
        Public links still open on the old dashboard for now. Links you make or revoke here, and the votes shown here, reach clients once the public pages move over.
      </p>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!brand ? <p className="text-sm text-muted-foreground">Choose a brand to see its approval link.</p> : !boards ? (
        error ? null : <p role="status" className="text-sm text-muted-foreground">Loading approval boards...</p>
      ) : (
        <>
          <section aria-label="Client link" className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">Client link</h2>
            {live ? (
              <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="live-link">
                <a href={approvalUrl(live.token)} target="_blank" rel="noopener noreferrer" className="break-all underline">{approvalUrl(live.token)}</a>
                <span className="text-xs text-muted-foreground">expires {formatDay(live.expires_at)}</span>
                <button type="button" className={CTRL} onClick={() => copy(approvalUrl(live.token))}>Copy link</button>
                <button type="button" className={CTRL} disabled={busy} onClick={() => revoke(live)}>Revoke</button>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">No live link for {brandName}.</span>
                <label className="text-xs">Expires<input aria-label="Expiry date" type="date" className={`${CTRL} ml-1`} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
                <button type="button" className={CTRL} disabled={busy} onClick={create}>Create link</button>
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
                  <button type="button" className={CTRL} disabled={busy} onClick={apply}>Apply decisions</button>
                </>
              )}
            </section>
          )}

          <section aria-label="Past links" className="rounded-lg border p-3 text-sm">
            <h2 className="font-semibold">Past links ({past.length})</h2>
            {past.length === 0 ? <p className="mt-1 text-muted-foreground">None.</p> : (
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
    </div>
  );
}
