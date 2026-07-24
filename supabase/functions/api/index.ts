import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApiAuth, corsHeaders } from "../_shared/api-auth.ts";
import { resolveConvention } from "../_shared/naming-convention.ts";
import { errorMessage } from "../_shared/error-message.ts";

// Rate limiting is enforced durably inside withApiAuth (see _shared/api-auth.ts),
// backed by the api_rate_limit_counters table — survives cold starts and holds
// across instances. Limit/window are env-configurable (API_RATE_LIMIT,
// API_RATE_LIMIT_WINDOW_SECONDS).

// Returns true if the userId is allowed to access the given accountId.
// Builders and employees have global access; clients must have a user_accounts row.
// NOTE: `supabase` is typed `any` here on purpose. The esm.sh `@supabase/supabase-js@2`
// floating tag now serves stricter client generics than the pinned-by-URL type used
// elsewhere, producing a spurious SupabaseClient<...,never,never> identity skew on the
// .rpc/.from calls below. Loosening this one param keeps the function checking cleanly
// without pinning a version that would diverge from the rest of the codebase.
async function verifyAccountOwnership(
  supabase: any,
  userId: string,
  accountId: string
): Promise<boolean> {
  // Check user role — builders and employees can access any account
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (role === "builder" || role === "employee") return true;

  // For clients (and any unrecognised role), verify the user_accounts link
  const { data, error } = await supabase
    .from("user_accounts")
    .select("1")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .maybeSingle();

  return !error && data !== null;
}

// Core router, extracted so it can be exercised by deno test against a mock
// Supabase client (US-004) without binding the network listener. withApiAuth
// has already validated the key, rate-limited the request, and resolved the
// caller's { userId, permissions } before this runs. Stays read-only: the only
// mutating path (POST /sync) just proxies the existing sync function.
export async function handleApi(
  req: Request,
  supabase: any,
  { userId, permissions }: { userId: string; permissions: string[] }
): Promise<Response> {
  if (!permissions.includes("read")) {
    return new Response(
      JSON.stringify({ error: "Insufficient permissions — key requires 'read' scope" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/functions\/v1\/api\/?/, "").replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const resource = pathParts[0];
  const resourceId = pathParts[1];

  try {
    // GET /api/accounts — scoped to the key's user, mirroring the accounts
    // edge function's access model: builders/employees see every account; a
    // client (or any unrecognised role) sees ONLY the ad_accounts they are
    // linked to via user_accounts. Previously this returned ALL accounts to
    // any API-key holder.
    if (resource === "accounts" && req.method === "GET") {
      const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
      const isStaff = role === "builder" || role === "employee";

      let allowedIds: string[] | null = null; // null = unrestricted (staff)
      if (!isStaff) {
        const { data: links, error: linksError } = await supabase
          .from("user_accounts")
          .select("account_id")
          .eq("user_id", userId);
        if (linksError) throw linksError;
        const ids: string[] = (links || []).map((l: { account_id: string }) => l.account_id);
        allowedIds = ids;
        if (ids.length === 0) {
          return new Response(JSON.stringify({ data: [] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      let query = supabase
        .from("ad_accounts")
        .select("id, name, creative_count, untagged_count, last_synced_at, is_active, created_at")
        .order("name");
      if (allowedIds) query = query.in("id", allowedIds);

      const { data, error } = await query;

      if (error) throw error;
      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/creatives or /api/creatives/:id
    if (resource === "creatives" && req.method === "GET") {
      if (resourceId) {
        const { data, error } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, account_id, spend, roas, ctr, cpa, cpm, cpc, impressions, clicks, purchases, purchase_value, adds_to_cart, unique_code, hook, theme, product, style, person, ad_type, tag_source, ad_status, thumbnail_url, video_url, meta_video_ids, play_curve, retention_p25, retention_p50, retention_p75, retention_p100, created_at, updated_at")
          .eq("ad_id", resourceId)
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const accountId = url.searchParams.get("account_id");

      if (accountId) {
        const allowed = await verifyAccountOwnership(supabase, userId, accountId);
        if (!allowed) {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const minRoas = url.searchParams.get("min_roas");
      const status = url.searchParams.get("status");

      let query = supabase
        .from("creatives")
        .select("ad_id, ad_name, account_id, spend, roas, ctr, cpa, cpm, cpc, impressions, clicks, purchases, purchase_value, adds_to_cart, unique_code, hook, theme, product, style, person, ad_type, tag_source, ad_status, thumbnail_url, video_url, meta_video_ids, play_curve, retention_p25, retention_p50, retention_p75, retention_p100, created_at, updated_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (accountId) query = query.eq("account_id", accountId);
      if (minRoas) query = query.gte("roas", parseFloat(minRoas));
      if (status) query = query.eq("ad_status", status);

      // Tag-dimension filters — exact match on a resolved tag column (US-006).
      // Tag columns hold DISPLAY names, so callers filter on the same values the
      // rows expose. tag_source lets consumers scope to e.g. only canonical rows.
      for (const dim of ["hook", "style", "person", "ad_type", "product", "theme", "tag_source"] as const) {
        const v = url.searchParams.get(dim);
        if (v) query = query.eq(dim, v);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ data, total: count, limit, offset }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/metrics
    if (resource === "metrics" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");

      if (accountId) {
        const allowed = await verifyAccountOwnership(supabase, userId, accountId);
        if (!allowed) {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { data, error } = await supabase.rpc("get_account_metrics", {
        p_account_id: accountId || null,
      });

      if (error) {
        // Fallback: paginate manually if RPC doesn't exist yet
        let allRows: any[] = [];
        let from = 0;
        const pageSize = 1000;
        while (true) {
          let q = supabase
            .from("creatives")
            .select("spend, impressions, clicks, purchases, purchase_value")
            .range(from, from + pageSize - 1);
          if (accountId) q = q.eq("account_id", accountId);
          const { data: page, error: pageErr } = await q;
          if (pageErr || !page || page.length === 0) break;
          allRows = allRows.concat(page);
          if (page.length < pageSize) break;
          from += pageSize;
        }

        const total_spend = allRows.reduce((s, c) => s + (c.spend || 0), 0);
        const total_purchase_value = allRows.reduce((s, c) => s + (c.purchase_value || 0), 0);
        const total_impressions = allRows.reduce((s, c) => s + (c.impressions || 0), 0);
        const total_clicks = allRows.reduce((s, c) => s + (c.clicks || 0), 0);
        const total_purchases = allRows.reduce((s, c) => s + (c.purchases || 0), 0);

        return new Response(JSON.stringify({
          data: {
            total_creatives: allRows.length,
            total_spend: Math.round(total_spend * 100) / 100,
            total_purchase_value: Math.round(total_purchase_value * 100) / 100,
            total_impressions,
            total_clicks,
            total_purchases,
            blended_roas: total_spend > 0 ? Math.round((total_purchase_value / total_spend) * 100) / 100 : 0,
            avg_ctr: total_impressions > 0 ? Math.round((total_clicks / total_impressions) * 10000) / 100 : 0,
            avg_cpa: total_purchases > 0 ? Math.round((total_spend / total_purchases) * 100) / 100 : 0,
          },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/summary
    if (resource === "summary" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");
      if (!accountId) {
        return new Response(JSON.stringify({ error: "account_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allowed = await verifyAccountOwnership(supabase, userId, accountId);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch account info
      const { data: account, error: accErr } = await supabase
        .from("ad_accounts")
        .select("id, name, creative_count, untagged_count, last_synced_at, is_active, target_roas, target_cpa, target_monthly_spend, primary_kpi, secondary_kpis")
        .eq("id", accountId)
        .single();

      if (accErr) throw accErr;

      // Aggregate metrics via pagination
      let allRows: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data: page, error: pageErr } = await supabase
          .from("creatives")
          .select("spend, roas, cpa, ctr, impressions, clicks, purchases, purchase_value, ad_status")
          .eq("account_id", accountId)
          .range(from, from + pageSize - 1);
        if (pageErr || !page || page.length === 0) break;
        allRows = allRows.concat(page);
        if (page.length < pageSize) break;
        from += pageSize;
      }

      const total_spend = allRows.reduce((s, c) => s + (c.spend || 0), 0);
      const total_revenue = allRows.reduce((s, c) => s + (c.purchase_value || 0), 0);
      const total_impressions = allRows.reduce((s, c) => s + (c.impressions || 0), 0);
      const total_clicks = allRows.reduce((s, c) => s + (c.clicks || 0), 0);
      const total_purchases = allRows.reduce((s, c) => s + (c.purchases || 0), 0);
      const active = allRows.filter(c => c.ad_status === "ACTIVE").length;

      return new Response(JSON.stringify({
        data: {
          account,
          metrics: {
            total_creatives: allRows.length,
            active_creatives: active,
            total_spend: Math.round(total_spend * 100) / 100,
            total_revenue: Math.round(total_revenue * 100) / 100,
            blended_roas: total_spend > 0 ? Math.round((total_revenue / total_spend) * 100) / 100 : 0,
            avg_ctr: total_impressions > 0 ? Math.round((total_clicks / total_impressions) * 10000) / 100 : 0,
            avg_cpa: total_purchases > 0 ? Math.round((total_spend / total_purchases) * 100) / 100 : 0,
            total_impressions,
            total_clicks,
            total_purchases,
          },
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /api/sync (requires 'sync' scope)
    if (resource === "sync" && req.method === "POST") {
      if (!permissions.includes("sync")) {
        return new Response(
          JSON.stringify({ error: "Insufficient permissions — key requires 'sync' scope" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let body: { account_id?: string };
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accountId = body?.account_id;
      if (!accountId) {
        return new Response(JSON.stringify({ error: "account_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allowed = await verifyAccountOwnership(supabase, userId, accountId);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Trigger sync via the existing sync edge function
      const syncUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync`;
      const resp = await fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({ account_id: accountId, sync_type: "api" }),
      });
      const result = await resp.json();

      return new Response(JSON.stringify({ data: result }), {
        status: resp.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/hooks — curated winning-hook library for an account (US-006).
    // Required: account_id. Optional: category, limit (max 500).
    // Response: { data: [{ hook_text, avg_hook_rate, usage_count, tags, category, source_ad_id }], account_id }
    if (resource === "hooks" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");
      if (!accountId) {
        return new Response(JSON.stringify({ error: "account_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allowed = await verifyAccountOwnership(supabase, userId, accountId);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
      const category = url.searchParams.get("category");

      let query = supabase
        .from("hooks")
        .select("id, hook_text, avg_hook_rate, usage_count, tags, category, source_ad_id", { count: "exact" })
        .eq("account_id", accountId)
        .order("avg_hook_rate", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (category) query = query.eq("category", category);

      const { data, error, count } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ data, total: count, account_id: accountId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/coverage — tagged vs untagged counts + tag_source distribution (US-006).
    // Required: account_id. Response:
    // { data: { account_id, total, tagged, untagged, coverage_pct, by_tag_source: {parsed,csv_match,csv,manual,untagged,...} } }
    if (resource === "coverage" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");
      if (!accountId) {
        return new Response(JSON.stringify({ error: "account_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allowed = await verifyAccountOwnership(supabase, userId, accountId);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Paginate tag_source for the account and tally — mirrors the metrics/summary
      // aggregation pattern. A null/empty tag_source counts as untagged.
      const bySource: Record<string, number> = {};
      let total = 0;
      let untagged = 0;
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data: page, error: pageErr } = await supabase
          .from("creatives")
          .select("tag_source")
          .eq("account_id", accountId)
          .range(from, from + pageSize - 1);
        if (pageErr) throw pageErr;
        if (!page || page.length === 0) break;
        for (const row of page) {
          total++;
          const src = (row.tag_source && String(row.tag_source).trim()) || "untagged";
          bySource[src] = (bySource[src] || 0) + 1;
          if (src === "untagged") untagged++;
        }
        if (page.length < pageSize) break;
        from += pageSize;
      }

      const tagged = total - untagged;
      return new Response(JSON.stringify({
        data: {
          account_id: accountId,
          total,
          tagged,
          untagged,
          coverage_pct: total > 0 ? Math.round((tagged / total) * 10000) / 100 : 0,
          by_tag_source: bySource,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET /api/convention — resolved naming convention + controlled vocabulary (US-006).
    // Optional: account_id (resolves the per-account override, else the global default).
    // Response: { data: { id, account_id, scope, separator, segments[], vocab[] } | null }
    if (resource === "convention" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");

      if (accountId) {
        const allowed = await verifyAccountOwnership(supabase, userId, accountId);
        if (!allowed) {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const convention = await resolveConvention(supabase, accountId || null);
      return new Response(JSON.stringify({ data: convention }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/angles — voice-of-customer angle clusters for an account (US-004).
    // Read-only. Required: account_id. Optional: theme, limit (max 500).
    // Mirrors the /hooks shape: account_id gate -> verifyAccountOwnership ->
    // ranked select. Response:
    // { data: [{ id, account_id, label, summary, theme, pains, desires,
    //   objections, customer_language, supporting_review_ids, score, source,
    //   created_at }], total, account_id }
    if (resource === "angles" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");
      if (!accountId) {
        return new Response(JSON.stringify({ error: "account_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allowed = await verifyAccountOwnership(supabase, userId, accountId);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
      const theme = url.searchParams.get("theme");

      let query = supabase
        .from("angle_clusters")
        .select("id, account_id, label, summary, theme, pains, desires, objections, customer_language, supporting_review_ids, score, source, created_at", { count: "exact" })
        .eq("account_id", accountId)
        .order("score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (theme) query = query.eq("theme", theme);

      const { data, error, count } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ data, total: count, account_id: accountId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/library — spend-ranked hook/angle leaderboard + coverage header.
    // Serves BOTH dimensions via ?dimension=hook|theme (theme == angle).
    // Aggregation/ranking lives ONLY in the RPCs (single source of truth); we
    // return the leaderboard rows in RPC order verbatim — no JS re-sort/re-rank.
    if (resource === "library" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");
      if (!accountId) {
        return new Response(JSON.stringify({ error: "account_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allowed = await verifyAccountOwnership(supabase, userId, accountId);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const dimension = url.searchParams.get("dimension") || "hook";
      if (dimension !== "hook" && dimension !== "theme") {
        return new Response(
          JSON.stringify({ error: "Invalid dimension — expected 'hook' or 'theme' (theme = angle)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const parsedLimit = parseInt(url.searchParams.get("limit") || "100", 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;

      const [leaderboard, coverage] = await Promise.all([
        supabase.rpc("rpc_hook_angle_leaderboard", {
          p_account_id: accountId,
          p_dimension: dimension,
          p_limit: limit,
        }),
        supabase.rpc("rpc_hook_angle_coverage", {
          p_account_id: accountId,
          p_dimension: dimension,
        }),
      ]);

      if (leaderboard.error) throw leaderboard.error;
      if (coverage.error) throw coverage.error;

      // rpc_hook_angle_coverage returns a single-row table; take the first row.
      const coverageRow = (coverage.data && coverage.data[0]) || {
        total_spend: 0, tagged_spend: 0, untagged_spend: 0, tag_coverage_pct: 0,
      };

      return new Response(JSON.stringify({
        dimension,
        coverage: {
          total_spend: coverageRow.total_spend,
          tagged_spend: coverageRow.tagged_spend,
          untagged_spend: coverageRow.untagged_spend,
          tag_coverage_pct: coverageRow.tag_coverage_pct,
        },
        // Preserve RPC ordering verbatim (is_untagged ASC, total_spend DESC).
        rows: leaderboard.data ?? [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/account-taxonomy — read-only mirror of the in-app account-taxonomy
    // function. Calls the SAME single read RPC (rpc_account_taxonomy) so the
    // external api surface + verdanote-read-mcp read byte-identical values to
    // React. Read-only: all taxonomy WRITES go through the session-authed
    // account-taxonomy edge function only.
    if (resource === "account-taxonomy" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");
      if (!accountId) {
        return new Response(JSON.stringify({ error: "account_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allowed = await verifyAccountOwnership(supabase, userId, accountId);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase.rpc("rpc_account_taxonomy", { p_account_id: accountId });
      if (error) throw error;
      return new Response(JSON.stringify({ taxonomy: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found", available_endpoints: ["/accounts", "/creatives", "/creatives/:id", "/metrics", "/summary", "/hooks", "/angles", "/coverage", "/convention", "/library", "/account-taxonomy", "/sync"] }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    // Log the real cause (supabase-js rejects with plain objects, not Errors)
    // but keep the external response generic — this is a public API surface.
    console.error("API error:", errorMessage(e));
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Bind the network listener unless a test imports the module (API_NO_SERVE=1),
// mirroring the ingest-reviews INGEST_NO_SERVE guard. The service-role client is
// built per-request here so handleApi stays injectable with a mock in tests.
if (!Deno.env.get("API_NO_SERVE")) {
  serve(withApiAuth(async (req, { userId, permissions }) => {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    return await handleApi(req, supabase, { userId, permissions });
  }));
}
