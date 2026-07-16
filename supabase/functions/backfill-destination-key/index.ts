// Landing Pages report (Creative Terminal — Phase 1, Feature 1), foundation F4.
//
// Sources each ad's destination URL from Meta (object_story_spec / asset_feed_spec),
// stores it as creatives.landing_page_url, and normalizes it into destination_key
// with the SAME shared util the going-forward sync will use (no split/merge drift).
//
// Invoke with:
//   { "account_id": "act_...", "dry_run": true,  "limit": 10 }  -> returns sample links, writes NOTHING
//   { "account_id": "act_...", "dry_run": false }               -> drains + writes landing_page_url + destination_key
//
// Builder account first (Goodo, act_782159176742035). verify_jwt=false in
// config.toml; call with the service/secret key at the gateway.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { extractDestinationLink, normalizeDestinationUrl } from "../_shared/normalize-destination.ts";

const META_API_VERSION = "v22.0";
const BUDGET_MS = 100_000; // 100s budget
// 20, not 50: requesting object_story_spec + asset_feed_spec for 50 ads at once
// makes Meta reject the batch with "Please reduce the amount of data you're asking
// for" on creative-heavy accounts. Smaller batches get through.
const META_BATCH = 20;

// extractDestinationLink now lives in _shared/normalize-destination.ts so the sync
// forward-fill uses the exact same extraction (no split/merge drift).

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const startMs = Date.now();
  const isTimedOut = () => Date.now() - startMs > BUDGET_MS;

  try {
    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id;
    const dryRun = body.dry_run === true;
    const limit = Math.min(Number(body.limit) || (dryRun ? 10 : 500), 500);

    if (!accountId) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Meta token precedence: META_ACCESS_TOKEN env secret first, then the
    // settings.meta_access_token DB row (same as sync / media-discovery).
    let metaToken = Deno.env.get("META_ACCESS_TOKEN");
    if (!metaToken) {
      const { data: tokenRow } = await supabase
        .from("settings").select("value").eq("key", "meta_access_token").single();
      metaToken = tokenRow?.value ?? undefined;
    }
    if (!metaToken) {
      return new Response(JSON.stringify({ error: "no meta access token (env or settings)" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let metaError: string | null = null;

    let scanned = 0;
    let withLink = 0;
    let updated = 0;
    let noLink = 0;
    const samples: { ad_id: string; landing_page_url: string | null; destination_key: string | null }[] = [];

    // One pass for dry-run (bounded by limit); drain loop for the real run.
    do {
      const { data: rows, error: fetchErr } = await supabase
        .from("creatives")
        .select("ad_id")
        .eq("account_id", accountId)
        .is("destination_key", null)
        .gt("impressions", 0)
        .limit(limit);

      if (fetchErr) throw fetchErr;
      if (!rows?.length) break;
      scanned += rows.length;

      for (let i = 0; i < rows.length && !isTimedOut(); i += META_BATCH) {
        const batch = rows.slice(i, i + META_BATCH) as { ad_id: string }[];
        const ids = batch.map((r) => r.ad_id);
        const url =
          `https://graph.facebook.com/${META_API_VERSION}/?ids=${ids.join(",")}` +
          `&fields=creative{object_story_spec,asset_feed_spec}&access_token=${encodeURIComponent(metaToken)}`;

        const resp = await fetch(url);
        const json = await resp.json();
        if (json.error) {
          metaError = json.error.message ?? String(json.error);
          console.error("Meta batch error:", metaError);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        // Group ad_ids by destination_key for bulk writes; collect no-link ids.
        const byKey = new Map<string, { adIds: string[]; link: string }>();
        const noLinkIds: string[] = [];

        for (const adId of ids) {
          const raw = extractDestinationLink(json[adId]?.creative);
          const key = normalizeDestinationUrl(raw);
          if (key === null) {
            noLinkIds.push(adId);
            if (dryRun && samples.length < limit) {
              samples.push({ ad_id: adId, landing_page_url: raw ?? null, destination_key: null });
            }
            continue;
          }
          withLink++;
          const entry = byKey.get(key) ?? { adIds: [], link: raw as string };
          entry.adIds.push(adId);
          byKey.set(key, entry);
          if (dryRun && samples.length < limit) {
            samples.push({ ad_id: adId, landing_page_url: raw ?? null, destination_key: key });
          }
        }

        if (!dryRun) {
          for (const [key, { adIds, link }] of byKey.entries()) {
            const { error: updErr } = await supabase
              .from("creatives")
              .update({ landing_page_url: link, destination_key: key })
              .in("ad_id", adIds);
            if (updErr) throw updErr;
            updated += adIds.length;
          }
          // Sentinel so the drain loop doesn't reselect no-destination ads forever.
          if (noLinkIds.length) {
            const { error: invErr } = await supabase
              .from("creatives")
              .update({ destination_key: "" })
              .in("ad_id", noLinkIds);
            if (invErr) throw invErr;
            noLink += noLinkIds.length;
          }
        } else {
          noLink += noLinkIds.length;
        }

        await new Promise((r) => setTimeout(r, 400)); // rate-limit courtesy
      }

      if (dryRun) break; // dry-run is a single bounded pass
    } while (!isTimedOut());

    return new Response(
      JSON.stringify({
        status: dryRun ? "dry_run" : "completed",
        account_id: accountId,
        scanned,
        with_link: withLink,
        updated,
        no_link: noLink,
        timed_out: isTimedOut(),
        meta_error: metaError,
        ...(dryRun ? { samples } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("backfill-destination-key error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
