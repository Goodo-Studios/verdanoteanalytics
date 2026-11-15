import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { CLIENT_ACCOUNT_SELECT, toClientAccount } from "../_shared/client-account-fields.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export interface Deps {
  /** Service-role client. Tests pass a fake; production builds one from the env. */
  client?: SupabaseLike;
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = deps.client ?? createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Auth: require builder or employee role
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Resolve roles tolerantly: a user may hold MULTIPLE user_roles rows
  // (the schema allows UNIQUE(user_id, role), so e.g. a builder can also be a
  // client). `.single()` THROWS on >1 rows, which previously collapsed to a
  // spurious 403 for any multi-role user — diverging from the app's own
  // get_user_role RPC (LIMIT 1). Fetch all rows and test membership instead.
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows || []).map((r: { role: string }) => r.role);
  const isStaff = roles.includes("builder") || roles.includes("employee");
  const isClientRole = roles.includes("client");
  if (!isStaff && !isClientRole) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/accounts\/?/, "").replace(/\/$/, "");

  try {
    // GET /accounts — staff see every account; a client (non-staff) sees ONLY
    // the ad_accounts they are linked to via user_accounts. This is what powers
    // the client Content Pipeline: without it the client receives an empty
    // account list and the pipeline can never resolve a selected account.
    if (req.method === "GET" && !path) {
      if (isStaff) {
        const { data, error } = await supabase
          .from("ad_accounts")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Client: scope to linked accounts only (never leak other clients').
      const { data: links } = await supabase
        .from("user_accounts")
        .select("account_id")
        .eq("user_id", user.id);
      const ids = (links || []).map((l: { account_id: string }) => l.account_id);
      if (ids.length === 0) {
        return new Response(JSON.stringify([]), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Only the client-safe columns. Row rules do not limit columns, and this
      // client is service-role anyway, so the column list is the wall here.
      const { data, error } = await supabase
        .from("ad_accounts")
        .select(CLIENT_ACCOUNT_SELECT)
        .in("id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const safe = (data || []).map((row: Record<string, unknown>) => toClientAccount(row));
      return new Response(JSON.stringify(safe), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Every remaining operation (create / update / delete / name-mappings) is
    // an admin write — staff only. Clients are read-only on accounts.
    if (!isStaff) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /accounts — add account
    if (req.method === "POST" && !path) {
      const body = await req.json();
      const { id, name } = body;

      if (!id || !name) {
        return new Response(JSON.stringify({ error: "id and name are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Idempotent upsert
      const { data, error } = await supabase
        .from("ad_accounts")
        .upsert({ id, name, is_active: true }, { onConflict: "id" })
        .select()
        .single();
      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PUT /accounts/:id — update account (toggle active, sync settings)
    if (req.method === "PUT" && path && !path.includes("/")) {
      const body = await req.json();
      const updateFields: Record<string, any> = {};
      if (body.name !== undefined) updateFields.name = body.name;
      if (body.is_active !== undefined) updateFields.is_active = body.is_active;
      if (body.date_range_days !== undefined) updateFields.date_range_days = body.date_range_days;
      if (body.winner_roas_threshold !== undefined) updateFields.winner_roas_threshold = body.winner_roas_threshold;
      if (body.iteration_spend_threshold !== undefined) updateFields.iteration_spend_threshold = body.iteration_spend_threshold;
      if (body.company_description !== undefined) updateFields.company_description = body.company_description;
      if (body.primary_kpi !== undefined) updateFields.primary_kpi = body.primary_kpi;
      if (body.secondary_kpis !== undefined) updateFields.secondary_kpis = body.secondary_kpis;
      if (body.company_pdf_url !== undefined) updateFields.company_pdf_url = body.company_pdf_url;
      if (body.creative_analysis_prompt !== undefined) updateFields.creative_analysis_prompt = body.creative_analysis_prompt;
      if (body.insights_prompt !== undefined) updateFields.insights_prompt = body.insights_prompt;
      if (body.report_schedule !== undefined) updateFields.report_schedule = body.report_schedule;
      if (body.winner_kpi !== undefined) updateFields.winner_kpi = body.winner_kpi;
      if (body.winner_kpi_direction !== undefined) updateFields.winner_kpi_direction = body.winner_kpi_direction;
      if (body.winner_kpi_threshold !== undefined) updateFields.winner_kpi_threshold = body.winner_kpi_threshold;
      if (body.scale_threshold !== undefined) updateFields.scale_threshold = body.scale_threshold;
      if (body.kill_threshold !== undefined) updateFields.kill_threshold = body.kill_threshold;
      if (body.target_roas !== undefined) updateFields.target_roas = body.target_roas;
      if (body.target_cpa !== undefined) updateFields.target_cpa = body.target_cpa;
      if (body.target_monthly_spend !== undefined) updateFields.target_monthly_spend = body.target_monthly_spend;
      if (body.optimization_goal !== undefined) updateFields.optimization_goal = body.optimization_goal;

      const { data, error } = await supabase
        .from("ad_accounts")
        .update(updateFields)
        .eq("id", path)
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE /accounts/:id — delete account
    if (req.method === "DELETE" && path) {
      // Builder only: this hard-deletes the account and everything under it.
      if (!roles.includes("builder")) {
        return new Response(JSON.stringify({ error: "Forbidden: builder only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Delete related data first to avoid foreign key violations. Stop on the first error so
      // a failure never leaves the account half-deleted with later steps silently skipped.
      const steps: Array<[string, string]> = [
        ["creative_daily_metrics", "account_id"],
        ["creatives", "account_id"],
        ["name_mappings", "account_id"],
        ["sync_logs", "account_id"],
        ["reports", "account_id"],
        ["ai_insights", "account_id"],
        ["user_accounts", "account_id"],
        ["ad_accounts", "id"],
      ];
      const done: string[] = [];
      for (const [table, col] of steps) {
        const { error } = await supabase.from(table).delete().eq(col, path);
        if (error) {
          console.error(`Account delete failed at ${table}:`, error.message);
          return new Response(JSON.stringify({
            error: `Account delete stopped at ${table}. Earlier steps were already applied.`,
            failed_at: table,
            completed: done,
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        done.push(table);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /accounts/:id/name-mappings — upload CSV name mappings
    if (req.method === "POST" && path.endsWith("/name-mappings")) {
      const accountId = path.replace("/name-mappings", "");
      const body = await req.json();
      const { mappings } = body;

      if (!Array.isArray(mappings) || mappings.length === 0) {
        return new Response(JSON.stringify({ error: "mappings array required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Bulk upsert in chunks (one request per chunk, not per row). A row with no code cannot
      // be keyed, and a repeated code inside one statement makes Postgres reject the chunk,
      // so the last row for a code wins.
      const byCode = new Map<string, Record<string, unknown>>();
      for (const m of mappings) {
        const code = m.unique_code || m.UniqueCode;
        if (!code) continue;
        byCode.set(String(code), {
          account_id: accountId,
          unique_code: String(code),
          ad_type: m.ad_type || m.Type,
          person: m.person || m.Person,
          style: m.style || m.Style,
          product: m.product || m.Product,
          hook: m.hook || m.Hook,
          theme: m.theme || m.Theme,
        });
      }
      const rowsToUpsert = [...byCode.values()];
      let upserted = 0;
      for (let i = 0; i < rowsToUpsert.length; i += 500) {
        const chunk = rowsToUpsert.slice(i, i + 500);
        const { error } = await supabase
          .from("name_mappings")
          .upsert(chunk, { onConflict: "account_id,unique_code" });
        if (error) throw error;
        upserted += chunk.length;
      }

      // Re-match untagged creatives. Read every untagged creative (paged past the 1000-row cap)
      // and every mapping for the account once, then update once per code.
      const untagged: Array<{ ad_id: string; unique_code: string | null }> = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("creatives")
          .select("ad_id, unique_code")
          .eq("account_id", accountId)
          .eq("tag_source", "untagged")
          .order("ad_id")
          .range(from, from + 999);
        if (error) throw error;
        untagged.push(...(data || []));
        if (!data || data.length < 1000) break;
      }

      const mappingByCode = new Map<string, Record<string, unknown>>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("name_mappings")
          .select("*")
          .eq("account_id", accountId)
          .order("unique_code")
          .range(from, from + 999);
        if (error) throw error;
        for (const row of data || []) mappingByCode.set(row.unique_code, row);
        if (!data || data.length < 1000) break;
      }

      const adIdsByCode = new Map<string, string[]>();
      const unmatched = new Set<string>();
      for (const creative of untagged) {
        if (!creative.unique_code) continue;
        if (mappingByCode.has(creative.unique_code)) {
          const list = adIdsByCode.get(creative.unique_code) ?? [];
          list.push(creative.ad_id);
          adIdsByCode.set(creative.unique_code, list);
        } else {
          unmatched.add(creative.unique_code);
        }
      }

      let matched = 0;
      for (const [code, adIds] of adIdsByCode) {
        const mapping = mappingByCode.get(code)!;
        for (let i = 0; i < adIds.length; i += 100) {
          const ids = adIds.slice(i, i + 100);
          const { error } = await supabase
            .from("creatives")
            .update({
              ad_type: mapping.ad_type,
              person: mapping.person,
              style: mapping.style,
              product: mapping.product,
              hook: mapping.hook,
              theme: mapping.theme,
              tag_source: "csv_match",
            })
            .in("ad_id", ids)
            .eq("tag_source", "untagged");
          if (error) throw error;
          matched += ids.length;
        }
      }

      // Update account counts
      const { count: totalCount } = await supabase
        .from("creatives")
        .select("*", { count: "exact", head: true })
        .eq("account_id", accountId);

      const { count: untaggedCount } = await supabase
        .from("creatives")
        .select("*", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("tag_source", "untagged");

      const { error: countsError } = await supabase
        .from("ad_accounts")
        .update({ creative_count: totalCount || 0, untagged_count: untaggedCount || 0 })
        .eq("id", accountId);
      if (countsError) throw countsError;

      return new Response(JSON.stringify({
        upserted,
        matched,
        // Distinct codes on still-untagged creatives that have no mapping.
        unmatchedCodes: unmatched.size,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Accounts error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Tests import the handler with ACCOUNTS_NO_SERVE set.
if (!Deno.env.get("ACCOUNTS_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
