import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Session-authed read path for the Entity Report cluster browser (Feature 2).
//
// rpc_entity_report / rpc_entity_cluster_members are SECURITY DEFINER and TRUST
// their p_account_id argument, so authenticated EXECUTE was revoked from them
// (see migration 20260717000002) to close a cross-account IDOR — identical to the
// leaderboard function's relationship with rpc_hook_angle_leaderboard. This
// function is the sanctioned first-party caller: verify the caller's session JWT,
// enforce verifyAccountOwnership(), then invoke the RPC with the service-role
// client. Aggregation stays entirely in SQL (single source of truth).
//
// Routes (GET):
//   /entity-report?account_id=…                 → headline + ranked clusters
//   /entity-report?account_id=…&cluster_id=…    → members of one cluster

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

  const clusterId = url.searchParams.get("cluster_id");

  try {
    if (clusterId) {
      const { data, error } = await supabase.rpc("rpc_entity_cluster_members", {
        p_account_id: accountId,
        p_cluster_id: clusterId,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ members: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.rpc("rpc_entity_report", {
      p_account_id: accountId,
    });
    if (error) throw error;

    // rpc_entity_report returns a single jsonb object { headline, clusters }.
    return new Response(JSON.stringify(data ?? { headline: null, clusters: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
