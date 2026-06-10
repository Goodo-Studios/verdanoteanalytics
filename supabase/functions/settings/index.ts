import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { errorMessage } from "../_shared/error-message.ts";


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Auth: require builder role
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
  // Fetch ALL role rows (a user may hold multiple) — `.single()` throws on >1
  // rows, turning a legitimate multi-role builder into a 403/500.
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows || []).map((r) => r.role);
  if (!roles.includes("builder")) {
    return new Response(JSON.stringify({ error: "Forbidden: builder only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/settings\/?/, "").replace(/\/$/, "");

  try {
    // GET /settings — return all settings (mask secrets)
    if (req.method === "GET" && !path) {
      const { data, error } = await supabase.from("settings").select("*");
      if (error) throw error;

      const settings: Record<string, string> = {};
      for (const row of data || []) {
        const key = row.key;
        const val = row.value || "";
        if (key === "meta_access_token" || key === "app_password") {
          settings[key] = val ? `****${val.slice(-4)}` : "";
          settings[`${key}_set`] = val ? "true" : "false";
        } else {
          settings[key] = val;
        }
      }

      // Check if META_ACCESS_TOKEN secret is set
      const metaSecret = Deno.env.get("META_ACCESS_TOKEN");
      if (metaSecret) {
        settings["meta_access_token_set"] = "true";
        settings["meta_access_token"] = `****${metaSecret.slice(-4)}`;
      }

      return new Response(JSON.stringify(settings), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PUT /settings — save settings
    if (req.method === "PUT" && !path) {
      const body = await req.json();
      const updates: { key: string; value: string }[] = [];

      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "string") {
          if (value.startsWith("****")) continue;
          updates.push({ key, value });
        }
      }

      for (const { key, value } of updates) {
        const { error } = await supabase
          .from("settings")
          .upsert({ key, value }, { onConflict: "key" });
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /settings/test-meta — test Meta connection
    if (req.method === "POST" && path === "test-meta") {
      const body = await req.json();
      let metaToken = body.token;

      // Use secret if no token provided
      if (!metaToken) {
        metaToken = Deno.env.get("META_ACCESS_TOKEN");
      }
      if (!metaToken) {
        // Fallback to DB
        const { data } = await supabase
          .from("settings")
          .select("value")
          .eq("key", "meta_access_token")
          .single();
        metaToken = data?.value;
      }

      if (!metaToken) {
        return new Response(JSON.stringify({ error: "No Meta access token configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const meResp = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(metaToken)}`);
      const meData = await meResp.json();

      if (meData.error) {
        return new Response(JSON.stringify({
          connected: false,
          error: meData.error.message,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const accountsResp = await fetch(
        `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${encodeURIComponent(metaToken)}`
      );
      const accountsData = await accountsResp.json();

      const debugResp = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(metaToken)}&access_token=${encodeURIComponent(metaToken)}`
      );
      const debugData = await debugResp.json();
      const expiresAt = debugData?.data?.expires_at;
      let tokenWarning = null;
      if (expiresAt) {
        const hoursLeft = (expiresAt - Date.now() / 1000) / 3600;
        if (hoursLeft < 2) {
          tokenWarning = "Token expires in less than 2 hours. Consider using a long-lived token.";
        } else if (hoursLeft < 24 * 7) {
          tokenWarning = `Token expires in ${Math.floor(hoursLeft / 24)} days.`;
        }
      }

      return new Response(JSON.stringify({
        connected: true,
        user: { id: meData.id, name: meData.name },
        accounts: accountsData.data || [],
        tokenWarning,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Settings error:", errorMessage(e));
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
