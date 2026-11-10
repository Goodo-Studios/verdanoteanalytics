// Application: staff page (consolidation step 5b, port of the old dashboard's
// Application detail and Actor application detail). Everything the applicant
// sent, their headshot and videos through signed links, a flag when the email
// is already on the roster, and the decision: approve (adds them to the
// roster and opens their new page) or reject with a reason. A decided
// application shows who decided it, when, and the reason.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, PageHeader, PageShell, TextField, useConfirm } from "@/components/page-kit";
import { useRolePrefix } from "@/hooks/useRolePath";
import { DashboardError } from "./api";
import { approveApplication, loadApplicationDetail, rejectApplication, type ApplicationDetail } from "./applicationsApi";
import { formatSubmitted, parseKind, reviewErrorText, socialLines, type Application } from "./applicationsModel";
import { safeHref } from "./rosterModel";

const yesNo = (v: boolean | null) => (v === null ? "Not answered" : v ? "Yes" : "No");

function fields(a: Application): [string, string][] {
  const common: [string, string][] = [["Email", a.email], ["Gender", a.gender ?? ""], ["Age range", a.age_range.join(", ")]];
  if ("categories" in a) {
    return [
      ...common,
      ["Location", a.location ?? ""],
      ["Shipping address", a.shipping_address ?? ""],
      ["Categories", a.categories.join(", ")],
      ["Socials", socialLines(a.socials).join("; ")],
      ["Alcohol OK", yesNo(a.alcohol_ok)],
      ["CBD OK", yesNo(a.cbd_ok)],
      ["THC OK", yesNo(a.thc_ok)],
      ["Family inclusive OK", yesNo(a.family_inclusive_ok)],
    ];
  }
  return [
    ...common,
    ["Phone", a.phone ?? ""],
    ["Dog owner", yesNo(a.dog_owner)],
    ["Kids in videos", a.kids_in_videos ?? ""],
    ["Notes", a.notes ?? ""],
  ];
}

function links(a: Application): string[] {
  const raw = "categories" in a ? [a.website] : [a.social_url, a.additional_social_url];
  return raw.map(safeHref).filter((x): x is string => !!x);
}

export default function ApplicationDetailPage() {
  const { kind: kindParam, id = "" } = useParams();
  const kind = parseKind(kindParam);
  const prefix = useRolePrefix();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await loadApplicationDetail(kind, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the application.");
    }
  }, [kind, id]);
  useEffect(() => {
    void load();
  }, [load]);

  const back = <Link to={`${prefix}/applications${kind === "actors" ? "?kind=actors" : ""}`} className="text-sm underline">Back to Applications</Link>;
  if (!detail) {
    return <PageShell data-testid="application-detail-page">{back}{error ? <ErrorState message={error} onRetry={() => { setError(null); void load(); }} /> : <LoadingState label="Loading the application" />}</PageShell>;
  }
  const a = detail.application;
  if (!a) {
    return <PageShell data-testid="application-detail-page">{back}<p className="text-sm">No application with this id.</p></PageShell>;
  }

  const fail = (e: unknown) => setError(e instanceof DashboardError ? reviewErrorText(e.code, e.message) : e instanceof Error ? e.message : "The change could not be saved.");
  const approve = async () => {
    const ok = await confirm({
      title: `Approve ${a.name}?`,
      description: `They are added to the ${kind === "creators" ? "creator" : "actor"} roster with their headshot and videos.`,
      actionLabel: "Approve",
      tone: "default",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const newId = await approveApplication(kind, a.id);
      navigate(`${prefix}/${kind}/${newId}`);
    } catch (e) {
      fail(e);
      setBusy(false);
      await load();
    }
  };
  const reject = async () => {
    if (!reason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rejectApplication(kind, a.id, reason.trim());
      setReason("");
    } catch (e) {
      fail(e);
    }
    setBusy(false);
    await load();
  };

  const headshot = a.headshot_path ? detail.links.get(a.headshot_path) : undefined;
  return (
    <PageShell data-testid="application-detail-page">
      {back}
      <PageHeader title={a.name} description={`${kind === "creators" ? "Creator" : "Actor"} application, submitted ${formatSubmitted(a.submitted_at)}`} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {detail.roster.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm" data-testid="roster-match">
          This email is already on the roster:{" "}
          {detail.roster.map((r) => <Link key={r.id} to={`${prefix}/${kind}/${r.id}`} className="mr-1 underline">{r.name}</Link>)}
        </p>
      )}

      <div className="flex flex-wrap gap-4">
        {headshot ? <img src={headshot} alt={`Headshot of ${a.name}`} className="h-40 w-40 rounded object-cover" />
          : <div className="flex h-40 w-40 items-center justify-center rounded bg-muted text-xs text-muted-foreground">{a.headshot_path ? "Headshot not in storage" : "No headshot"}</div>}
        <dl className="grid flex-1 grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
          {fields(a).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v || "Not given"}</dd></div>
          ))}
          {links(a).map((href) => (
            <div key={href} className="contents"><dt className="text-muted-foreground">Link</dt><dd><a href={href} target="_blank" rel="noopener noreferrer" className="underline">{href}</a></dd></div>
          ))}
        </dl>
      </div>

      <section aria-label="Videos" className="rounded-lg border p-3">
        <h2 className="text-sm font-semibold">Videos ({detail.videos.length})</h2>
        {detail.videos.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No videos.</p> : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {detail.videos.map((v, i) => {
              const url = detail.links.get(v.storage_path);
              const thumb = v.thumbnail_path ? detail.links.get(v.thumbnail_path) : undefined;
              const label = v.title || `Video ${i + 1}`;
              return (
                <li key={v.id} className="w-32 text-xs">
                  {thumb ? <img src={thumb} alt={label} className="h-24 w-32 rounded object-cover" /> : <div className="h-24 w-32 rounded bg-muted" />}
                  <div className="truncate">{label}</div>
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">Play</a> : <span className="text-muted-foreground">File not in storage</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Decision" className="rounded-lg border p-3 text-sm">
        <h2 className="font-semibold">Decision</h2>
        {a.status === "pending" ? (
          <div className="mt-2 space-y-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void approve()}>Approve</Button>
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="Rejection reason" hideLabel className="min-w-[18rem]" placeholder="Reason, kept on the application" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button type="button" variant="outline" disabled={busy} onClick={() => void reject()}>Reject</Button>
            </div>
          </div>
        ) : (
          <p className="mt-1" data-testid="decision">
            {a.status === "approved" ? "Approved" : "Rejected"}
            {a.reviewed_at ? ` on ${formatSubmitted(a.reviewed_at)}` : ""}
            {a.app_users?.name ? ` by ${a.app_users.name}` : ""}
            {a.status === "rejected" && a.review_notes ? `. Reason: ${a.review_notes}` : "."}
          </p>
        )}
      </section>
      {dialog}
    </PageShell>
  );
}
