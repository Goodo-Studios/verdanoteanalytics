import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  parseTaxonomyRequest,
  selectSeedFromRows,
  ORIGIN_MANUAL,
} from "../_shared/account-taxonomy-logic.ts";

// US-002: Per-account taxonomy config API (Theme/Persona list + creative-type
// activation). Session-authed first-party edge function — the in-app write/read
// surface (the external `api` function is the key-gated read mirror).
//
// Pattern mirrors leaderboard / landing-pages: verify_jwt=false at the gateway,
// verify the caller's session JWT here (supabase.auth.getUser), enforce
// verifyAccountOwnership, then use the service-role client for DB access.
//
// READS go through ONE SECURITY DEFINER RPC (rpc_account_taxonomy) so React, this
// function, the `api` function, and verdanote-read-mcp all read identical values.
// WRITES go only to Postgres (angle_clusters + account_creative_types); Coda stays
// read-only upstream. Writes here never touch creatives tag columns / tag_source,
// so the locked tag precedence (manual > csv_match > parsed > ai > untagged) is
// unaffected — a taxonomy edit can never demote an existing creative tag.

// Builders and employees have global access; clients must have a user_accounts row.
// deno-lint-ignore no-explicit-any
async function verifyAccountOwnership(supabase: any, userId: string, accountId: string): Promise<boolean> {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (role === "builder" || role === "employee") return true;
  const { data, error } = await supabase
    .from("user_accounts").select("1").eq("user_id", userId).eq("account_id", accountId).maybeSingle();
  return !error && data !== null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// The single read path. Returns the RPC's jsonb payload verbatim so every surface
// (React / api / MCP) reads byte-identical values.
// deno-lint-ignore no-explicit-any
async function readTaxonomy(supabase: any, accountId: string) {
  const { data, error } = await supabase.rpc("rpc_account_taxonomy", { p_account_id: accountId });
  if (error) throw error;
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Auth: require a valid user session JWT.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return jsonResponse({ error: "Unauthorized", detail: authError?.message }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON" }, 400);
  }

  // account_id from body (query param accepted as a fallback).
  const url = new URL(req.url);
  const accountId =
    (typeof (body as Record<string, unknown>)?.account_id === "string"
      ? (body as Record<string, string>).account_id
      : null) ?? url.searchParams.get("account_id");

  const parsed = parseTaxonomyRequest(body, accountId);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

  const acct = parsed.accountId!;
  const allowed = await verifyAccountOwnership(supabase, user.id, acct);
  if (!allowed) return jsonResponse({ error: "Access denied" }, 403);

  try {
    switch (parsed.action!) {
      case "list": {
        return jsonResponse({ taxonomy: await readTaxonomy(supabase, acct) });
      }

      case "create": {
        // New Theme/Persona in the account's list. origin=manual distinguishes it
        // from review-mining rows ('csv' / 'csv:<batch>').
        const { data, error } = await supabase
          .from("angle_clusters")
          .insert({ account_id: acct, label: parsed.name, source: ORIGIN_MANUAL })
          .select("id, label, source, created_at")
          .single();
        if (error) throw error;
        return jsonResponse({ created: data, taxonomy: await readTaxonomy(supabase, acct) }, 201);
      }

      case "rename": {
        const { data, error } = await supabase
          .from("angle_clusters")
          .update({ label: parsed.name })
          .eq("id", parsed.angleId)
          .eq("account_id", acct)
          .select("id, label")
          .maybeSingle();
        if (error) throw error;
        if (!data) return jsonResponse({ error: "Theme/Persona not found for this account" }, 404);
        return jsonResponse({ renamed: data, taxonomy: await readTaxonomy(supabase, acct) });
      }

      case "archive":
      case "unarchive": {
        // Soft archive — never a hard delete, so creatives.angle_id references stay intact.
        const archived_at = parsed.action === "archive" ? new Date().toISOString() : null;
        const { data, error } = await supabase
          .from("angle_clusters")
          .update({ archived_at })
          .eq("id", parsed.angleId)
          .eq("account_id", acct)
          .select("id, archived_at")
          .maybeSingle();
        if (error) throw error;
        if (!data) return jsonResponse({ error: "Theme/Persona not found for this account" }, 404);
        return jsonResponse({ updated: data, taxonomy: await readTaxonomy(supabase, acct) });
      }

      case "set_creative_type": {
        // Activate/deactivate a house-menu creative type for this account.
        // Upsert on the (account_id, creative_type_id) unique key so toggling is idempotent.
        const { data, error } = await supabase
          .from("account_creative_types")
          .upsert(
            { account_id: acct, creative_type_id: parsed.creativeTypeId, active: parsed.active },
            { onConflict: "account_id,creative_type_id" },
          )
          .select("id, creative_type_id, active")
          .single();
        if (error) throw error;
        return jsonResponse({ activation: data, taxonomy: await readTaxonomy(supabase, acct) });
      }

      case "seed": {
        // Seed the Theme/Persona list from REAL existing data only. The list IS
        // angle_clusters (US-001) and review-mining (ingest-reviews) already lands
        // its clusters there, so seeding recognizes those review-mining rows as the
        // initial governed list. There is no BID-territories source in the DB, so
        // review-mining is the only source; when none exist the list stays empty —
        // never fabricated, no LLM call, no write.
        const { data: rows, error } = await supabase
          .from("angle_clusters")
          .select("id, source, archived_at")
          .eq("account_id", acct);
        if (error) throw error;

        const seed = selectSeedFromRows(rows);
        return jsonResponse({
          seed: {
            source: seed.empty ? "none" : "review_mining",
            review_mining_count: seed.reviewMiningCount,
            seeded_ids: seed.seededIds,
            empty: seed.empty,
          },
          taxonomy: await readTaxonomy(supabase, acct),
        });
      }
    }
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
