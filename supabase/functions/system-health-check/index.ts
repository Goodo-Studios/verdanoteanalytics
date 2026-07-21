import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const findings: Array<{
    severity: "pass" | "warn" | "fail";
    category: string;
    message: string;
    details?: Record<string, unknown>;
  }> = [];

  const now = new Date();

  try {
    // ─── 1. Stuck Syncs ─────────────────────────────────────────
    const { data: stuckSyncs } = await supabase
      .from("sync_logs")
      .select("id, account_id, started_at, current_phase")
      .eq("status", "running")
      .lt("started_at", new Date(now.getTime() - 30 * 60 * 1000).toISOString());

    if (stuckSyncs?.length) {
      findings.push({
        severity: "fail",
        category: "sync",
        message: `${stuckSyncs.length} sync(s) appear stuck (running > 30 min)`,
        details: { sync_ids: stuckSyncs.map((s: any) => s.id), phases: stuckSyncs.map((s: any) => s.current_phase) },
      });
    } else {
      findings.push({ severity: "pass", category: "sync", message: "No stuck syncs detected" });
    }

    // ─── 2. Stuck Media Refreshes ───────────────────────────────
    const { data: stuckMedia } = await supabase
      .from("media_refresh_logs")
      .select("id, started_at")
      .eq("status", "running")
      .lt("started_at", new Date(now.getTime() - 20 * 60 * 1000).toISOString());

    if (stuckMedia?.length) {
      findings.push({
        severity: "warn",
        category: "media",
        message: `${stuckMedia.length} media refresh(es) stuck (running > 20 min)`,
        details: { ids: stuckMedia.map((s: any) => s.id) },
      });
    } else {
      findings.push({ severity: "pass", category: "media", message: "No stuck media refreshes" });
    }

    // ─── 3. Stale Accounts (active but no sync in 7+ days) ─────
    // Freshness is judged against each account's OWN cadence, not a flat 7-day window.
    // A flat threshold let a 12h-cadence account silently rot for ~2 weeks before
    // tripping (the 2026-06-09 outage). Here a scheduled account is "stale" once it
    // has missed ~2.5 cadence windows, and a badly overdue scheduled account (>3 days)
    // is a hard fail. Manual accounts only warn at 7+ days (no automatic cadence).
    const cadenceHours: Record<string, number> = { "6h": 6, "12h": 12, daily: 24 };
    const { data: freshnessRows } = await supabase
      .from("ad_accounts")
      .select("id, name, last_synced_at, sync_frequency")
      .eq("is_active", true);

    const staleWarn: Array<Record<string, unknown>> = [];
    const staleFail: Array<Record<string, unknown>> = [];
    for (const a of freshnessRows || []) {
      const ageMs = a.last_synced_at ? now.getTime() - new Date(a.last_synced_at).getTime() : Infinity;
      const ageHours = ageMs / 36e5;
      const row = { id: a.id, name: a.name, last: a.last_synced_at, frequency: a.sync_frequency, age_hours: Math.round(ageHours) };

      if (a.sync_frequency === "manual") {
        if (ageHours > 7 * 24) staleWarn.push(row);
        continue;
      }
      const cadence = cadenceHours[a.sync_frequency] ?? 24;
      if (ageHours > 72) staleFail.push(row);            // scheduled but >3 days dead
      else if (ageHours > cadence * 2.5) staleWarn.push(row); // missed ~2.5 cadence windows
    }

    if (staleFail.length) {
      findings.push({
        severity: "fail",
        category: "freshness",
        message: `${staleFail.length} scheduled account(s) have not synced in 3+ days — automated sync may be broken`,
        details: { accounts: staleFail },
      });
    }
    if (staleWarn.length) {
      findings.push({
        severity: "warn",
        category: "freshness",
        message: `${staleWarn.length} account(s) overdue for their sync cadence`,
        details: { accounts: staleWarn },
      });
    }
    if (!staleFail.length && !staleWarn.length) {
      findings.push({ severity: "pass", category: "freshness", message: "All active accounts fresh for their cadence" });
    }

    // ─── 4. Recent Sync Failures (last 8h) ──────────────────────
    const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString();
    const { data: recentFails, count: failCount } = await supabase
      .from("sync_logs")
      .select("id, account_id, api_errors", { count: "exact" })
      .eq("status", "failed")
      .gte("started_at", eightHoursAgo);

    if (failCount && failCount > 0) {
      // Resolve account names for failed syncs
      const failAccountIds = [...new Set((recentFails || []).map((s: any) => s.account_id))];
      const { data: failAccounts } = await supabase
        .from("ad_accounts")
        .select("id, name")
        .in("id", failAccountIds);
      const accNameMap: Record<string, string> = {};
      for (const a of failAccounts || []) accNameMap[a.id] = a.name;

      findings.push({
        severity: "warn",
        category: "sync",
        message: `${failCount} sync failure(s) in the last 8 hours`,
        details: {
          failures: (recentFails || []).slice(0, 5).map((s: any) => ({
            sync_id: s.id,
            account: accNameMap[s.account_id] || s.account_id,
          })),
        },
      });
    } else {
      findings.push({ severity: "pass", category: "sync", message: "No sync failures in the last 8 hours" });
    }

    // ─── 5. Thumbnail Coverage (accounts with <60% coverage) ────
    const { data: accounts } = await supabase
      .from("ad_accounts")
      .select("id, name")
      .eq("is_active", true);

    const lowCoverageAccounts: Array<{ name: string; pct: number }> = [];

    for (const acc of accounts || []) {
      const { count: withSpend } = await supabase
        .from("creatives")
        .select("ad_id", { count: "exact", head: true })
        .eq("account_id", acc.id)
        .gt("spend", 0);

      if (!withSpend || withSpend < 10) continue;

      const { count: withThumb } = await supabase
        .from("creatives")
        .select("ad_id", { count: "exact", head: true })
        .eq("account_id", acc.id)
        .gt("spend", 0)
        .not("thumbnail_url", "is", null)
        .neq("thumbnail_url", "no-thumbnail");

      const pct = Math.round(((withThumb || 0) / withSpend) * 100);
      if (pct < 60) {
        lowCoverageAccounts.push({ name: acc.name, pct });
      }
    }

    if (lowCoverageAccounts.length) {
      findings.push({
        severity: "warn",
        category: "media",
        message: `${lowCoverageAccounts.length} account(s) with < 60% thumbnail coverage`,
        details: { accounts: lowCoverageAccounts },
      });
    } else {
      findings.push({ severity: "pass", category: "media", message: "All accounts above 60% thumbnail coverage" });
    }

    // ─── 5b. Playable Video Coverage ────────────────────────────
    // The main Meta `sync` does NOT populate `ad_format`, so there is no reliable
    // "is this a video ad" denominator on synced creatives. The only trustworthy
    // signal is the `video_url` state itself. Report, per active account, how many
    // creatives have a PLAYABLE cached video (a storage URL) vs the `no-video`
    // sentinel vs null/other. This is the ground-truth signal for "do videos play
    // in-app" — the modal renders a <video> only when video_url is a real URL.
    // One grouped query (rpc_media_coverage) instead of ~4 count round-trips per
    // account — see migration 20260601000002. The 60+ separate counts previously
    // timed out the whole health check under load.
    const accNameById: Record<string, string> = {};
    for (const acc of accounts || []) accNameById[acc.id] = acc.name;

    const { data: covRows } = await supabase.rpc("rpc_media_coverage");
    const videoCoverage = ((covRows || []) as Array<{
      account_id: string; total: number; playable: number;
      sentinel: number; null_url: number; cdn_only: number;
      thumb_storage: number; thumb_null: number; thumb_sentinel: number;
      thumb_cdn: number; sample_thumbs: string[] | null; mismarked: number;
    }>)
      // Only active accounts (the RPC groups every account in creatives).
      .filter((r) => accNameById[r.account_id] && Number(r.total) > 0)
      .map((r) => ({
        name: accNameById[r.account_id], account_id: r.account_id,
        total: Number(r.total), playable: Number(r.playable),
        sentinel: Number(r.sentinel), nullUrl: Number(r.null_url),
        cdnOnly: Number(r.cdn_only),
        thumbStorage: Number(r.thumb_storage), thumbNull: Number(r.thumb_null),
        thumbSentinel: Number(r.thumb_sentinel), thumbCdn: Number(r.thumb_cdn),
        sampleThumbs: r.sample_thumbs || [],
        // Sentinel rows that are actually videos (have play-time) = discovery false-negatives.
        mismarked: Number(r.mismarked),
      }));

    // Flag accounts that have NULL video_url rows (never-attempted) — these are
    // rows whose video discovery has not run since being nulled (e.g. blocked by a
    // stuck media-refresh log). cdnOnly > 0 means a raw expiring CDN url was written
    // but never cached to storage. Both are actionable.
    const needsVideoWork = videoCoverage.filter((a) => a.nullUrl > 0 || a.cdnOnly > 0);
    if (needsVideoWork.length) {
      findings.push({
        severity: "warn",
        category: "media",
        message: `${needsVideoWork.length} account(s) with un-cached or never-attempted videos`,
        details: { accounts: needsVideoWork, all: videoCoverage },
      });
    } else {
      findings.push({
        severity: "pass",
        category: "media",
        message: "All accounts: videos cached or sentineled (none pending)",
        details: { all: videoCoverage },
      });
    }

    // ─── 6. Orphaned Creatives (no matching account) ────────────
    const accountIds = (accounts || []).map((a: any) => a.id);
    if (accountIds.length > 0) {
      const { count: orphanCount } = await supabase
        .from("creatives")
        .select("ad_id", { count: "exact", head: true })
        .not("account_id", "in", `(${accountIds.join(",")})`);

      if (orphanCount && orphanCount > 0) {
        findings.push({
          severity: "warn",
          category: "integrity",
          message: `${orphanCount} creative(s) reference non-existent accounts`,
        });
      } else {
        findings.push({ severity: "pass", category: "integrity", message: "No orphaned creatives found" });
      }
    }

    // ─── 7. Queued Syncs Waiting Too Long ───────────────────────
    const { data: oldQueued } = await supabase
      .from("sync_logs")
      .select("id, account_id, started_at")
      .eq("status", "queued")
      .lt("started_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString());

    if (oldQueued?.length) {
      findings.push({
        severity: "warn",
        category: "sync",
        message: `${oldQueued.length} sync(s) queued for over 1 hour`,
        details: { ids: oldQueued.map((s: any) => s.id) },
      });
    } else {
      findings.push({ severity: "pass", category: "sync", message: "No stale queued syncs" });
    }

    // ─── 8. Edge Function Connectivity Spot-Check ───────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const functionsToCheck = ["accounts", "creatives", "settings", "sync"];
    const functionResults: Record<string, string> = {};

    for (const fn of functionsToCheck) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
          method: "OPTIONS",
          headers: { "Authorization": `Bearer ${anonKey}` },
        });
        functionResults[fn] = resp.ok || resp.status === 204 ? "ok" : `status_${resp.status}`;
        await resp.text(); // consume body
      } catch (e) {
        functionResults[fn] = `error: ${String(e).slice(0, 60)}`;
      }
    }

    const failedFns = Object.entries(functionResults).filter(([, v]) => v !== "ok");
    if (failedFns.length) {
      findings.push({
        severity: "fail",
        category: "functions",
        message: `${failedFns.length} edge function(s) not responding`,
        details: { results: functionResults },
      });
    } else {
      findings.push({
        severity: "pass",
        category: "functions",
        message: `All ${functionsToCheck.length} core edge functions responding`,
        details: { results: functionResults },
      });
    }

  } catch (e) {
    findings.push({
      severity: "fail",
      category: "system",
      message: `Health check error: ${String(e).slice(0, 200)}`,
    });
  }

  // Compute overall status
  const hasFail = findings.some((f) => f.severity === "fail");
  const hasWarn = findings.some((f) => f.severity === "warn");
  const overallStatus = hasFail ? "fail" : hasWarn ? "warn" : "pass";
  const durationMs = Date.now() - start;

  const summary = {
    total_checks: findings.length,
    pass: findings.filter((f) => f.severity === "pass").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    fail: findings.filter((f) => f.severity === "fail").length,
  };

  // ─── Slack alert on status TRANSITION (watchdog) ───────────────────────────
  // This function detects stale accounts + broken sync, but historically nothing
  // ran it and nothing was alerted — so the 2026-06 and 2026-07 sync outages went
  // unseen behind the (still-running) Coda crons. Now that it is cron-scheduled,
  // page Slack when overall status CHANGES (fail on entry, recovery on exit) so a
  // persistent issue doesn't spam every 30-min run. Best-effort; never fails the
  // check. Reads the prior status BEFORE the new row is inserted below.
  const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL");
  if (slackUrl) {
    try {
      const { data: prev } = await supabase
        .from("health_checks")
        .select("status")
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevStatus = (prev as { status?: string } | null)?.status ?? "pass";

      if (overallStatus === "fail" && prevStatus !== "fail") {
        const lines = findings
          .filter((f) => f.severity !== "pass")
          .map((f) => `• [${f.severity}] ${f.message}`)
          .join("\n");
        await fetch(slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `:rotating_light: *Verdanote health check: FAIL* (${summary.fail} fail / ${summary.warn} warn)\n${lines}`,
          }),
        }).catch(() => {});
      } else if (overallStatus === "pass" && prevStatus === "fail") {
        await fetch(slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `:white_check_mark: *Verdanote health recovered* — all ${summary.total_checks} checks passing.`,
          }),
        }).catch(() => {});
      }
    } catch (_e) {
      // Alerting is best-effort — a Slack failure must never break the health check.
    }
  }

  // Persist result
  await supabase.from("health_checks").insert({
    status: overallStatus,
    findings: JSON.stringify(findings),
    summary,
    duration_ms: durationMs,
  });

  // Keep only last 50 health checks
  const { data: old } = await supabase
    .from("health_checks")
    .select("id")
    .order("checked_at", { ascending: false })
    .range(50, 1000);

  if (old?.length) {
    await supabase.from("health_checks").delete().in("id", old.map((r: any) => r.id));
  }

  console.log(`Health check completed: ${overallStatus} (${summary.pass}✓ ${summary.warn}⚠ ${summary.fail}✗) in ${durationMs}ms`);

  return new Response(JSON.stringify({ status: overallStatus, summary, findings, duration_ms: durationMs }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
