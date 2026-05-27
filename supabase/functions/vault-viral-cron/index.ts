// Weekly auto-refresh for the GLOBAL viral feed.
// Invoked by pg_cron via net.http_post() with the service role key — no user JWT.
// Scheduled via migration 20260527000003_viral_feed_cron.sql (weekly, Sunday 07:00 UTC).
//
// Trending pass only — uses clockworks~tiktok-scraper with hashtags[] input and
// TikTok Shop product-selling hashtags (tiktokmademebuyit, tiktokshopfinds,
// tiktokshop, shopwithtiktok). 400 items = 4 hashtags × resultsPerPage:100 each.
// NOTE: clockworks uses `resultsPerPage` (per hashtag), NOT `maxItems`.
// Search with user-defined seed queries disabled — TikTok anti-bot returns 0 results.
//
// Ported from Creative Vault vault-viral-cron with workspace iteration removed —
// viral_feed_items is a global table in Verdanote (no workspace_id column), so
// a single fan-out per platform is all that's needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { SUPPORTED_PLATFORMS } from "../_shared/trending-configs.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // CRON_SERVICE_ROLE_KEY is explicitly set as a project secret (same value as
  // the service_role key) because SUPABASE_SERVICE_ROLE_KEY cannot be set as a
  // user secret (prefix blocked) and its auto-injected value may differ from
  // what the edge gateway expects for inter-function Authorization headers.
  const cronAuthKey = Deno.env.get("CRON_SERVICE_ROLE_KEY") ?? serviceRoleKey;

  try {
    // Global feed — no workspace iteration. One trending pass per platform.
    // max_items: 400 = 4 TikTok Shop hashtags × 100 resultsPerPage each.
    // vault-viral-refresh distributes the budget via resultsPerPage (not maxItems —
    // that field is silently ignored by clockworks~tiktok-scraper).
    let triggered = 0;
    const errors: string[] = [];

    for (const platform of SUPPORTED_PLATFORMS) {
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/vault-viral-refresh`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cronAuthKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              platform,
              max_items: 400,
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.status }));
          errors.push(`${platform}/trending: ${err.error ?? res.status}`);
        } else {
          triggered++;
        }
      } catch (e) {
        errors.push(`${platform}/trending: ${String(e)}`);
      }
    }

    console.log(`Cron: ${SUPPORTED_PLATFORMS.length} platforms, ${triggered} triggered, ${errors.length} errors`);
    if (errors.length) console.error("Errors:", errors);

    return json({ ok: true, platforms: SUPPORTED_PLATFORMS.length, triggered, errors });
  } catch (err) {
    console.error("vault-viral-cron error:", err);
    return json({ error: String(err) }, 500);
  }
});
