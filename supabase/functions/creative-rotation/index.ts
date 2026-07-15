import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Session-authed read fn for the Creative Rotation report. The three
// rpc_creative_rotation_* RPCs are SECURITY DEFINER and trust their
// p_account_id argument, so authenticated EXECUTE was revoked (IDOR) — this fn
// is the sanctioned first-party caller. Mirrors leaderboard/index.ts: verify the
// session JWT (auth.getUser), enforce verifyAccountOwnership(), then invoke the
// RPCs with the service-role client. All aggregation lives in SQL; rows verbatim.

// Builders and employees have global access; clients must have a user_accounts row.
async function verifyAccountOwnership(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  accountId: string,
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

function isValidDate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isValidDate(from) || !isValidDate(to)) {
    return new Response(
      JSON.stringify({ error: "from and to are required (YYYY-MM-DD)" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const parsedFresh = parseInt(url.searchParams.get("fresh_days") || "14", 10);
  const freshDays = [7, 14, 30].includes(parsedFresh) ? parsedFresh : 14;

  try {
    const [freshness, cohorts, timeline] = await Promise.all([
      supabase.rpc("rpc_creative_rotation_freshness", {
        p_account_id: accountId, p_from: from, p_to: to, p_fresh_days: freshDays,
      }),
      supabase.rpc("rpc_creative_rotation_cohorts", {
        p_account_id: accountId, p_from: from, p_to: to,
      }),
      supabase.rpc("rpc_creative_rotation_new_ads_timeline", {
        p_account_id: accountId, p_from: from, p_to: to,
      }),
    ]);

    if (freshness.error) throw freshness.error;
    if (cohorts.error) throw cohorts.error;
    if (timeline.error) throw timeline.error;

    const rows = (freshness.data ?? []);
    // deno-lint-ignore no-explicit-any
    const weekly = rows.filter((r: any) => r.bucket === "week");
    // deno-lint-ignore no-explicit-any
    const total = rows.find((r: any) => r.bucket === "total") ?? null;

    return new Response(JSON.stringify({
      fresh_days: freshDays,
      from,
      to,
      kpis: total,          // window-level freshness KPIs (single row) or null
      weekly_age: weekly,   // stacked spend-by-age + freshness-vs-CPA series
      cohorts: cohorts.data ?? [],
      new_ads_timeline: timeline.data ?? [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
