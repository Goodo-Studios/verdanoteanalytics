// vault-viral-refresh — kick off a fresh Apify run for one platform.
// Two callers:
//   • vault-viral-cron (service role) — weekly trending pass, no search query.
//   • Frontend user (user JWT) — on-demand refresh; any authenticated user can
//     trigger because the viral feed is global.
//
// Ported from Creative Vault with all workspace_id references stripped — the
// Verdanote viral_feed_items table has no workspace_id column.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { TRENDING_CONFIGS, SUPPORTED_PLATFORMS } from "../_shared/trending-configs.ts";

const APIFY_BASE = "https://api.apify.com/v2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const apifyToken = Deno.env.get("APIFY_TOKEN");

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    // Supabase verifies JWT signatures at the edge before the function runs.
    // Decode the payload to check the role claim — no env var comparison needed.
    let isServiceRole = false;
    try {
      const payloadB64 = token.split(".")[1] ?? "";
      const payload = JSON.parse(atob(payloadB64));
      isServiceRole = payload?.role === "service_role";
    } catch {
      // Malformed token — falls through to user JWT path and fails normally.
    }

    if (!isServiceRole) {
      // Verify the caller is an authenticated user. Any auth'd user can
      // refresh the global feed — no workspace membership check needed.
      const { data: { user }, error: authErr } = await createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      ).auth.getUser();
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const platformFilter: string | null = body.platform ?? null;
    // Cap raised to 500: 4 hashtags × 125 resultsPerPage = 500 total items.
    // The previous cap of 100 silently truncated the cron's budget before
    // trending-configs could distribute it across hashtags.
    const maxItems: number = Math.min(body.max_items ?? 100, 500);
    const searchQuery: string = (body.search_query ?? "").trim();

    if (!apifyToken) return json({ error: "APIFY_TOKEN secret not configured" }, 500);

    const platforms = platformFilter ? [platformFilter] : SUPPORTED_PLATFORMS;
    const runs: Record<string, string> = {};

    for (const platform of platforms) {
      const config = TRENDING_CONFIGS[platform];
      if (!config) continue;

      // Webhook URL omits workspace_id — global feed.
      const webhookParams = new URLSearchParams({
        platform,
        search_query: searchQuery,
      });
      const webhookUrl = `${supabaseUrl}/functions/v1/vault-viral-webhook?${webhookParams}`;
      const webhooks = [
        {
          eventTypes: [
            "ACTOR.RUN.SUCCEEDED",
            "ACTOR.RUN.FAILED",
            "ACTOR.RUN.ABORTED",
            "ACTOR.RUN.TIMED_OUT",
          ],
          requestUrl: webhookUrl,
        },
      ];
      const webhooksParam = encodeURIComponent(btoa(JSON.stringify(webhooks)));

      const actorInput = searchQuery
        ? config.buildSearchInput(searchQuery, maxItems)
        : config.buildInput(maxItems);

      // For search queries, prefer a dedicated search actor if the config
      // defines one (e.g. apify~tiktok-scraper uses residential proxies and
      // handles hashtag/search endpoints far better than the trending actor).
      const actorId = (searchQuery && config.searchActorId)
        ? config.searchActorId
        : config.actorId;

      const runRes = await fetch(
        `${APIFY_BASE}/acts/${actorId}/runs?token=${apifyToken}&webhooks=${webhooksParam}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(actorInput),
        }
      );

      if (!runRes.ok) {
        const text = await runRes.text();
        console.error(`Failed to start Apify run for ${platform}: ${runRes.status} ${text.slice(0, 200)}`);
        continue;
      }

      const runData = await runRes.json();
      const runId: string = runData?.data?.id ?? "(unknown)";
      runs[platform] = runId;
      console.log(`Started viral refresh run ${runId} for platform=${platform}`);
    }

    return json({ ok: true, runs });
  } catch (err) {
    console.error("vault-viral-refresh error:", err);
    return json({ error: String(err) }, 500);
  }
});
