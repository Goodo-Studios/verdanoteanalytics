import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { parseMatrixCellParams, parseMatrixParams } from "../_shared/matrix-logic.ts";

// US-006: session-authed read path for the 2-D creative matrix
// (Theme/Persona × creative-type cross-tab).
//
// US-008 extends this SAME function (no new edge fn ⇒ no deploy-script change)
// with a cell drill-down view: `GET matrix?view=cell&account_id=…&angle_id=…&
// creative_type=…` invokes rpc_creative_matrix_cell to open one Theme/Persona ×
// creative-type cell into its inner hook × body grid + atomic ads. Same auth +
// ownership gate; same verbatim-jsonb posture (the RPC is the single source of
// truth for aggregation / spend-ranking).
//
// rpc_creative_matrix is SECURITY DEFINER and trusts its p_account_id
// argument, so EXECUTE was revoked from PUBLIC + authenticated (migration
// 20260724000003) to close a cross-account IDOR — only service_role may call
// it. Per policy verdanote-in-app-ui-uses-session-authed-edge-function-not-api,
// the in-app UI must NOT go through the external API-key-authed `api` function
// (it authenticates with provisioned api_keys, not user session JWTs); this
// function is the first-party path: verify the caller's session JWT
// (auth.getUser), enforce verifyAccountOwnership(), then invoke the RPC with
// the service-role client — exactly the leaderboard / account-taxonomy posture.
//
// Aggregation, spend-ranking, and untagged bucketing live ONLY in the SQL RPC
// (single source of truth); the jsonb payload is returned VERBATIM (no JS
// re-sort/re-rank/re-shape) so React, /api/matrix, and verdanote-read-mcp read
// byte-identical numbers. This replaces the old account-strategy-layer grid
// read as the matrix data source for the in-app UI.

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

  // ── US-008 cell drill-down view: ?view=cell → rpc_creative_matrix_cell ──────
  if (url.searchParams.get("view") === "cell") {
    // Shared with the GET /api/matrix drill-down so validation is identical.
    const cellParams = parseMatrixCellParams(
      url.searchParams.get("account_id"),
      url.searchParams.get("angle_id"),
      url.searchParams.get("creative_type"),
      url.searchParams.get("date_from"),
      url.searchParams.get("date_to")
    );
    if (!cellParams.ok) {
      return new Response(JSON.stringify({ error: cellParams.error }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cellAllowed = await verifyAccountOwnership(supabase, user.id, cellParams.accountId);
    if (!cellAllowed) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const { data, error } = await supabase.rpc("rpc_creative_matrix_cell", {
        p_account_id: cellParams.accountId,
        p_angle_id: cellParams.angleId,
        p_creative_type: cellParams.creativeType,
        p_date_from: cellParams.dateFrom,
        p_date_to: cellParams.dateTo,
      });
      if (error) throw error;

      // Verbatim jsonb — ordering / spend-ranking is the RPC's.
      return new Response(JSON.stringify({ cell: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("matrix cell error:", err instanceof Error ? err.message : JSON.stringify(err));
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Shared with GET /api/matrix so validation is identical across surfaces.
  const params = parseMatrixParams(
    url.searchParams.get("account_id"),
    url.searchParams.get("date_from"),
    url.searchParams.get("date_to")
  );
  if (!params.ok) {
    return new Response(JSON.stringify({ error: params.error }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const allowed = await verifyAccountOwnership(supabase, user.id, params.accountId);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Access denied" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data, error } = await supabase.rpc("rpc_creative_matrix", {
      p_account_id: params.accountId,
      p_date_from: params.dateFrom,
      p_date_to: params.dateTo,
    });
    if (error) throw error;

    // Return the RPC's jsonb payload verbatim — ordering/ranking is the RPC's.
    return new Response(JSON.stringify({ matrix: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Log the real cause; keep the response generic.
    console.error("matrix error:", err instanceof Error ? err.message : JSON.stringify(err));
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
