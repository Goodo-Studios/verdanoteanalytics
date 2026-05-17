import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Verify caller is builder
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user: caller } } = await supabase.auth.getUser(token);
  if (!caller) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check builder role
  const { data: callerRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id)
    .single();

  if (callerRole?.role !== "builder") {
    return new Response(JSON.stringify({ error: "Forbidden: builder only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/user-management\/?/, "").replace(/\/$/, "");

  try {
    // GET /user-management — list all users with roles and accounts
    if (req.method === "GET" && !path) {
      const { data: profiles } = await supabase.from("profiles").select("*").order("created_at");
      const { data: roles } = await supabase.from("user_roles").select("*");
      const { data: userAccounts } = await supabase.from("user_accounts").select("*");

      const users = (profiles || []).map((p: any) => ({
        ...p,
        role: (roles || []).find((r: any) => r.user_id === p.user_id)?.role || null,
        account_ids: (userAccounts || []).filter((ua: any) => ua.user_id === p.user_id).map((ua: any) => ua.account_id),
      }));

      return new Response(JSON.stringify(users), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /user-management — create user
    if (req.method === "POST" && !path) {
      const { email, password, role, display_name, account_ids } = await req.json();

      if (!email || !password || !role) {
        return new Response(JSON.stringify({ error: "email, password, and role are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create auth user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createError) throw createError;
      const userId = newUser.user.id;

      // Update display name if provided
      if (display_name) {
        await supabase.from("profiles").update({ display_name }).eq("user_id", userId);
      }

      // Set role
      await supabase.from("user_roles").insert({ user_id: userId, role });

      // Link accounts (for clients)
      if (account_ids && account_ids.length > 0) {
        const links = account_ids.map((account_id: string) => ({ user_id: userId, account_id }));
        await supabase.from("user_accounts").insert(links);
      }

      return new Response(JSON.stringify({ success: true, user_id: userId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PUT /user-management/:userId — update user role/accounts
    if (req.method === "PUT" && path) {
      const userId = path;
      const { role, account_ids, display_name } = await req.json();

      if (display_name !== undefined) {
        await supabase.from("profiles").update({ display_name }).eq("user_id", userId);
      }

      if (role) {
        await supabase.from("user_roles").delete().eq("user_id", userId);
        await supabase.from("user_roles").insert({ user_id: userId, role });
      }

      if (account_ids !== undefined) {
        await supabase.from("user_accounts").delete().eq("user_id", userId);
        if (account_ids.length > 0) {
          const links = account_ids.map((account_id: string) => ({ user_id: userId, account_id }));
          await supabase.from("user_accounts").insert(links);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE /user-management/:userId — delete user
    if (req.method === "DELETE" && path) {
      const userId = path;
      await supabase.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("User management error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
