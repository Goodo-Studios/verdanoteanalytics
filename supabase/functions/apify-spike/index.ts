import { corsHeaders, json } from "../_shared/cors.ts";

// =============================================================================
// apify-spike — TEMPORARY US-000 spike proxy for the Apify API.
// =============================================================================
// De-risks the apify-creative-capture backfill (US-004) by letting the spike
// operator start paid `apify~facebook-ads-scraper` runs against ACCOUNT ads
// (identifiers pulled from our DB) and read back run status + usage/billing,
// WITHOUT ever exposing APIFY_TOKEN (it lives only in Supabase edge secrets).
//
// SECURITY: this starts PAID actor runs. Unlike apify-debug (which relies on the
// platform verify_jwt gate + a user_roles builder check), this function is
// registered with verify_jwt = false so it can be called with the service-role
// bearer directly from a shell. The ONLY gate is an exact string compare of the
// request bearer against SUPABASE_SERVICE_ROLE_KEY. No anon/user JWT is ever
// admitted. Delete this function once the spike is complete.
//
// Actions (POST body.action):
//   "start"   — POST /acts/{actorId}/runs with body.input; returns the run object.
//   "run"     — GET  /actor-runs/{runId}; supports body.waitForFinish (seconds,
//               <=60) to block server-side until the run terminates.
//   "dataset" — GET  /actor-runs/{runId}/dataset/items; returns dataset items.
//   "usage"   — GET  /actor-runs/{runId} and surfaces the usage/billing fields
//               (usageTotalUsd, chargedEventCounts, pricePerResult where present).
// =============================================================================

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_ID = "apify~facebook-ads-scraper";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Gate: bearer must EXACTLY equal the service-role key ────────────────────
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  if (!serviceRoleKey || bearer.length === 0 || bearer !== serviceRoleKey) {
    return json({ error: "Forbidden" }, 403);
  }

  const apifyToken = Deno.env.get("APIFY_TOKEN");
  if (!apifyToken) return json({ error: "APIFY_TOKEN not configured" }, 500);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "");

  try {
    // ── start: launch a paid actor run ────────────────────────────────────────
    if (action === "start") {
      const input = body.input ?? {};
      // Facebook ad pages are heavy — mirror the vault/scrape-ad memory default.
      const memory = Number(body.memory ?? 2048);
      const timeout = Number(body.timeout ?? 120);
      const res = await fetch(
        `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${apifyToken}&memory=${memory}&timeout=${timeout}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const data = await res.json().catch(() => ({}));
      return json({ status: res.status, run: data?.data ?? data }, res.ok ? 200 : res.status);
    }

    // ── run: poll run status, optionally block until finished ──────────────────
    if (action === "run") {
      const runId = String(body.run_id ?? body.runId ?? "");
      if (!runId) return json({ error: "run_id required" }, 400);
      // waitForFinish (seconds, Apify caps at 60) lets Apify hold the response
      // until the run terminates, avoiding tight client polling.
      const wff = body.waitForFinish != null ? Math.min(Number(body.waitForFinish), 60) : undefined;
      const qs = wff != null ? `&waitForFinish=${wff}` : "";
      const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apifyToken}${qs}`);
      const data = await res.json().catch(() => ({}));
      const run = data?.data ?? data;
      return json({
        status: res.status,
        run_status: run?.status,
        startedAt: run?.startedAt,
        finishedAt: run?.finishedAt,
        defaultDatasetId: run?.defaultDatasetId,
        usageTotalUsd: run?.usageTotalUsd,
        usageUsd: run?.usageUsd,
        stats: run?.stats,
      }, res.ok ? 200 : res.status);
    }

    // ── dataset: fetch the run's dataset items ─────────────────────────────────
    if (action === "dataset") {
      const runId = String(body.run_id ?? body.runId ?? "");
      if (!runId) return json({ error: "run_id required" }, 400);
      const limit = body.limit != null ? `&limit=${Number(body.limit)}` : "";
      const res = await fetch(
        `${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${apifyToken}&clean=true${limit}`,
      );
      const items = await res.json().catch(() => ([]));
      return json({ status: res.status, count: Array.isArray(items) ? items.length : 0, items }, res.ok ? 200 : res.status);
    }

    // ── usage: surface the run's billing/usage totals ──────────────────────────
    if (action === "usage") {
      const runId = String(body.run_id ?? body.runId ?? "");
      if (!runId) return json({ error: "run_id required" }, 400);
      const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apifyToken}`);
      const data = await res.json().catch(() => ({}));
      const run = data?.data ?? data;
      return json({
        status: res.status,
        run_status: run?.status,
        usageTotalUsd: run?.usageTotalUsd,
        usageUsd: run?.usageUsd,
        chargedEventCounts: run?.chargedEventCounts,
        pricePerResult: run?.pricePerResult ?? run?.options?.pricePerResult,
        pricingInfo: run?.pricingInfo,
        stats: run?.stats,
        // Full run object retained for spike inspection of any billing field
        // whose exact key varies by actor/platform version.
        run,
      }, res.ok ? 200 : res.status);
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
