import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleAccounts } = await supabase
      .from("ad_accounts")
      .select("id, name, last_synced_at")
      .eq("is_active", true)
      .or(`last_synced_at.is.null,last_synced_at.lt.${sevenDaysAgo}`);

    if (staleAccounts?.length) {
      findings.push({
        severity: "warn",
        category: "freshness",
        message: `${staleAccounts.length} active account(s) not synced in 7+ days`,
        details: { accounts: staleAccounts.map((a: any) => ({ id: a.id, name: a.name, last: a.last_synced_at })) },
      });
    } else {
      findings.push({ severity: "pass", category: "freshness", message: "All active accounts synced within 7 days" });
    }

    // ─── 4. Recent Sync Failures (last 8h) ──────────────────────
    const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString();
    const { data: recentFails, count: failCount } = await supabase
      .from("sync_logs")
      .select("id, account_id, api_errors", { count: "exact" })
      .eq("status", "failed")
      .gte("started_at", eightHoursAgo);

    if (failCount && failCount > 0) {
      findings.push({
        severity: "warn",
        category: "sync",
        message: `${failCount} sync failure(s) in the last 8 hours`,
        details: { sample_ids: (recentFails || []).slice(0, 5).map((s: any) => s.id) },
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
