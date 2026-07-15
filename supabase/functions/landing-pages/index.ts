import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Landing Pages report (Creative Terminal — Phase 1, Feature 1), US-003.
//
// Session-authed read path for the Landing Pages report. get_landing_pages_report
// is SECURITY DEFINER and trusts p_account_id, so authenticated EXECUTE was revoked
// (migration 20260714000013) to close a cross-account IDOR. This function is the
// only sanctioned caller: verify the user's session JWT, enforce account ownership,
// then invoke the RPC with the service-role client. Aggregation stays in SQL.

// Builders and employees have global access; clients must have a user_accounts row.
// deno-lint-ignore no-explicit-any
async function verifyAccountOwnership(supabase: any, userId: string, accountId: string): Promise<boolean> {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (role === "builder" || role === "employee") return true;
  const { data, error } = await supabase
    .from("user_accounts").select("1").eq("user_id", userId).eq("account_id", accountId).maybeSingle();
  return !error && data !== null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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

  // Window: explicit from/to, else default to the last 30 days. Capped at 365 by the RPC.
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = url.searchParams.get("from") || isoDate(defaultFrom);
  const to = url.searchParams.get("to") || isoDate(now);
  const parsedMin = parseFloat(url.searchParams.get("min_spend") || "0");
  const minSpend = Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : 0;

  try {
    const { data, error } = await supabase.rpc("get_landing_pages_report", {
      p_account_id: accountId,
      p_from: from,
      p_to: to,
      p_min_spend: minSpend,
    });
    if (error) throw error;

    return new Response(
      JSON.stringify({ account_id: accountId, from, to, min_spend: minSpend, rows: data ?? [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
