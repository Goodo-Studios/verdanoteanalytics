// vault-status — port from Creative Vault (US-002). User-scoped; RLS gates the lookup.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const url = new URL(req.url);
    const itemId = url.searchParams.get("item_id") ?? (await req.json().catch(() => ({}))).item_id;

    if (!itemId) return json({ error: "item_id required" }, 400);

    const { data, error } = await supabase
      .from("inspiration_items")
      .select("id, status, error_message")
      .eq("id", itemId)
      .single();

    if (error || !data) return json({ error: "Item not found" }, 404);

    return json({ item_id: data.id, status: data.status, error_message: data.error_message });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
