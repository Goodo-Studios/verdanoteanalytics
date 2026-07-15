import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildCreatedTimeUrl, extractLaunchDates } from "../_shared/lifecycle-dates.ts";

// F2 backfill: populate creatives.created_time (and thus launch_date) from the
// Meta Graph API for ads that predate our created_time capture, then derive the
// full lifecycle-date set for the account. Mirrors backfill-post-urls (batch
// ?ids=...&fields=... field expansion, 50-per-batch, budget guard) and the
// backfill-daily-history token precedence (env META_ACCESS_TOKEN first, then the
// settings.meta_access_token row).
//
// Internal/trusted caller (orchestrator, cron). No user JWT — auth is the
// service-role key + the shared Meta token, exactly like the sibling backfill
// functions. Registered verify_jwt=false.

const META_API_VERSION = "v22.0";
const BUDGET_MS = 100_000; // 100s budget, same as backfill-post-urls

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Meta token: env first, then the settings table (same fallback as sync /
  // backfill-daily-history).
  let metaToken = Deno.env.get("META_ACCESS_TOKEN");
  if (!metaToken) {
    const { data: tokenRow } = await supabase
      .from("settings").select("value").eq("key", "meta_access_token").single();
    metaToken = tokenRow?.value;
  }
  if (!metaToken) {
    return new Response(
      JSON.stringify({ error: "META_ACCESS_TOKEN not configured" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const startMs = Date.now();
  const isTimedOut = () => Date.now() - startMs > BUDGET_MS;

  try {
    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id;
    if (!accountId) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Creatives with no created_time yet (older ads predating that field).
    const { data: missing, error: fetchErr } = await supabase
      .from("creatives")
      .select("ad_id")
      .eq("account_id", accountId)
      .is("created_time", null)
      .limit(500);

    if (fetchErr) throw fetchErr;

    let updated = 0;
    let failed = 0;

    if (missing?.length) {
      console.log(`Backfilling created_time for ${missing.length} creatives in ${accountId}`);
      const batchSize = 50;
      for (let i = 0; i < missing.length && !isTimedOut(); i += batchSize) {
        const batch = missing.slice(i, i + batchSize);
        // deno-lint-ignore no-explicit-any
        const adIds = batch.map((c: any) => c.ad_id);
        const url = buildCreatedTimeUrl(META_API_VERSION, adIds, metaToken);

        try {
          const resp = await fetch(url);
          const jsonBody = await resp.json();

          if (jsonBody.error) {
            console.error("Batch fetch error:", jsonBody.error.message);
            failed += batch.length;
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }

          const updates = extractLaunchDates(jsonBody, adIds);
          for (const u of updates) {
            const { error: updErr } = await supabase
              .from("creatives")
              .update({ created_time: u.created_time, launch_date: u.launch_date })
              .eq("ad_id", u.ad_id);
            if (!updErr) updated++;
            else failed++;
          }
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error("Batch processing error:", err);
          failed += batch.length;
        }
      }
    }

    // Derive the full lifecycle-date set (launch_date / first_added_date /
    // first_spend_date) for the account from data we already hold. Idempotent —
    // recomputes every row, so it also fixes ads whose created_time was already
    // present but whose launch_date column was never populated.
    const { data: derived, error: deriveErr } = await supabase.rpc(
      "derive_creative_lifecycle_dates",
      { p_account_id: accountId },
    );
    if (deriveErr) throw deriveErr;

    console.log(
      `backfill-launch-dates complete: ${updated} created_time updated, ${failed} failed, ${derived} rows derived`,
    );

    return new Response(
      JSON.stringify({
        status: "completed",
        account_id: accountId,
        created_time_updated: updated,
        failed,
        total_missing: missing?.length ?? 0,
        lifecycle_rows_derived: derived,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("backfill-launch-dates error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
