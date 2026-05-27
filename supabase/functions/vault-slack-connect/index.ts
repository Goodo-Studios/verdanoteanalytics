// vault-slack-connect — port from Creative Vault (US-011).
// Differences from source:
//   • workspace_id stripped — slack_connections is scoped by user_id (auth.uid()).
//   • upsert key changed to (user_id, team_id) — see migration 20260527000001.
//
// Verifies the user's Slack bot token, auto-detects team metadata, and stores
// the connection so vault-slack-events can resolve incoming webhooks to a user.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { bot_token, signing_secret } =
    await req.json() as {
      bot_token: string;
      signing_secret: string;
    };

  if (!bot_token || !signing_secret) {
    return json({ error: "bot_token and signing_secret are required" }, 400);
  }

  // Validate token and auto-detect team metadata via Slack auth.test.
  const authTest = await fetch("https://slack.com/api/auth.test", {
    headers: { Authorization: `Bearer ${bot_token}` },
  });
  const authData = await authTest.json();
  if (!authData.ok) {
    return json({ error: `Slack token invalid: ${authData.error}` }, 400);
  }
  const team_id: string = authData.team_id;
  const team_name: string = authData.team;

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data, error } = await db
    .from("slack_connections")
    .upsert(
      { user_id: user.id, team_id, team_name, bot_token, signing_secret },
      { onConflict: "user_id,team_id" },
    )
    .select()
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ connection_id: data.id, team_id: data.team_id, team_name: data.team_name });
});
