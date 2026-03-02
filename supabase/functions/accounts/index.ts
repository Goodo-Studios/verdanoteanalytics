import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
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
  const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
  if (!userRole || !["builder", "employee"].includes(userRole.role)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/accounts\/?/, "").replace(/\/$/, "");

  try {
    // GET /accounts — list all accounts
    if (req.method === "GET" && !path) {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      // Delete related data first to avoid foreign key violations
      await supabase.from("creative_daily_metrics").delete().eq("account_id", path);
      await supabase.from("creatives").delete().eq("account_id", path);
      await supabase.from("name_mappings").delete().eq("account_id", path);
      await supabase.from("sync_logs").delete().eq("account_id", path);
      await supabase.from("reports").delete().eq("account_id", path);
      await supabase.from("ai_insights").delete().eq("account_id", path);
      await supabase.from("user_accounts").delete().eq("account_id", path);

      const { error } = await supabase
        .from("ad_accounts")
        .delete()
        .eq("id", path);
      if (error) throw error;
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

      let upserted = 0;
      for (const m of mappings) {
        const { error } = await supabase
          .from("name_mappings")
          .upsert({
            account_id: accountId,
            unique_code: m.unique_code || m.UniqueCode,
            ad_type: m.ad_type || m.Type,
            person: m.person || m.Person,
            style: m.style || m.Style,
            product: m.product || m.Product,
            hook: m.hook || m.Hook,
            theme: m.theme || m.Theme,
          }, { onConflict: "account_id,unique_code" });
        if (!error) upserted++;
      }

      // Re-match untagged creatives
      const { data: untagged } = await supabase
        .from("creatives")
        .select("ad_id, unique_code")
        .eq("account_id", accountId)
        .eq("tag_source", "untagged");

      let matched = 0;
      for (const creative of untagged || []) {
        if (!creative.unique_code) continue;
        const { data: mapping } = await supabase
          .from("name_mappings")
          .select("*")
          .eq("account_id", accountId)
          .eq("unique_code", creative.unique_code)
          .single();

        if (mapping) {
          await supabase
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
            .eq("ad_id", creative.ad_id);
          matched++;
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

      await supabase
        .from("ad_accounts")
        .update({ creative_count: totalCount || 0, untagged_count: untaggedCount || 0 })
        .eq("id", accountId);

      return new Response(JSON.stringify({
        upserted,
        matched,
        unmatchedCodes: upserted - matched,
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
});
