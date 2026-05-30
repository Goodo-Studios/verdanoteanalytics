import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Session-authed sibling of the external `api` /library route.
//
// The hook/angle leaderboard RPCs (rpc_hook_angle_leaderboard /
// rpc_hook_angle_coverage) are SECURITY DEFINER and trust their p_account_id
// argument, so authenticated EXECUTE was revoked from them (see migration
// 20260530210000) to close a cross-account IDOR. The external `api` function is
// the only sanctioned caller — but it authenticates with provisioned API keys
// (api_keys table), NOT user session JWTs, so the in-app UI could never use it
// and saw "Invalid API key". This function gives the UI a first-party path:
// verify the caller's session JWT, enforce verifyAccountOwnership(), then invoke
// the RPCs with the service-role client. Aggregation/ranking stays entirely in
// the SQL RPCs (single source of truth); rows are returned verbatim.

// Builders and employees have global access; clients must have a user_accounts row.
async function verifyAccountOwnership(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  accountId: string
): Promise<boolean> {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (role === "builder" || role === "employee") return true;

  const { data, error } = await supabase
    .from("user_accounts")
    .select("1")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .maybeSingle();

  return !error && data !== null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Auth: require a valid user session JWT.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized", detail: authError?.message }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id");
  if (!accountId) {
    return new Response(JSON.stringify({ error: "account_id is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const allowed = await verifyAccountOwnership(supabase, user.id, accountId);
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

  try {
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
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
