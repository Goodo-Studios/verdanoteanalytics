import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Atomically claim accounts due for sync by advancing next_sync_at before processing.
    // Using UPDATE...RETURNING ensures only one concurrent invocation claims each account,
    // preventing duplicate syncs from at-least-once cron delivery.
    // We advance by 6 hours (the minimum sync cadence) as a claim placeholder;
    // the correct next_sync_at is recalculated and written after the sync completes.
    const now = new Date().toISOString();
    const { data: dueAccounts, error: queryError } = await supabase.rpc(
      "claim_due_sync_accounts",
      { cutoff: now }
    );

    // Fallback: if the RPC isn't available, use a raw query approach via the REST API
    // (the rpc call above requires a matching Postgres function; see migration notes).
    // As an inline alternative that works with the JS client, we use two steps but
    // guard with a unique constraint / advisory lock pattern via a direct SQL approach:
    // We fetch then immediately UPDATE with a WHERE next_sync_at = <fetched value> to
    // simulate CAS (compare-and-swap). However, the cleanest production path is the RPC.
    // For now, if the RPC fails (function not found), fall through to the legacy path with a warning.
    if (queryError && queryError.code !== "PGRST202") {
      console.error("Error claiming accounts:", queryError);
      return new Response(JSON.stringify({ error: queryError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If RPC not found, fall back to atomic UPDATE via raw SQL through supabase-js
    let claimedAccounts = dueAccounts;
    if (queryError?.code === "PGRST202") {
      console.warn("claim_due_sync_accounts RPC not found, using inline UPDATE...RETURNING");
      // 6 hours in the future as a safe claim window (minimum sync cadence)
      const claimUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      const { data: updated, error: updateError } = await supabase
        .from("ad_accounts")
        .update({ next_sync_at: claimUntil })
        .neq("sync_frequency", "manual")
        .eq("is_active", true)
        .or(`next_sync_at.is.null,next_sync_at.lte.${now}`)
        .select("id, name, sync_frequency, sync_hour, sync_timezone, next_sync_at, last_synced_at");
      if (updateError) {
        console.error("Error claiming accounts via UPDATE:", updateError);
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      claimedAccounts = updated;
    }

    if (!claimedAccounts || claimedAccounts.length === 0) {
      return new Response(JSON.stringify({ triggered: 0, message: "No accounts due for sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const triggered: string[] = [];

    for (const account of claimedAccounts) {
      try {
        // Trigger sync via the existing sync edge function
        const syncResp = await fetch(`${supabaseUrl}/functions/v1/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            account_id: account.id,
            sync_type: "scheduled",
          }),
        });

        if (!syncResp.ok) {
          const errText = await syncResp.text();
          console.error(`Failed to trigger sync for ${account.name}: ${errText}`);
          continue;
        }

        // Calculate next_sync_at based on frequency (DST-aware)
        const nextSync = calculateNextSync(account.sync_frequency, account.sync_hour, account.sync_timezone);

        // Update next_sync_at
        await supabase
          .from("ad_accounts")
          .update({ next_sync_at: nextSync.toISOString() })
          .eq("id", account.id);

        triggered.push(account.id);
        console.log(`Triggered sync for ${account.name}, next at ${nextSync.toISOString()}`);
      } catch (e) {
        console.error(`Error processing ${account.name}:`, e);
      }
    }

    return new Response(
      JSON.stringify({ triggered: triggered.length, accounts: triggered }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("scheduled-sync error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * DST-aware next sync calculation using Intl.DateTimeFormat
 * instead of hardcoded UTC offsets.
 */
function calculateNextSync(frequency: string, hour: number, timezone: string): Date {
  const now = new Date();

  switch (frequency) {
    case "6h": {
      return new Date(now.getTime() + 6 * 60 * 60 * 1000);
    }
    case "12h": {
      return new Date(now.getTime() + 12 * 60 * 60 * 1000);
    }
    case "daily": {
      // Use Intl to get the current offset for the timezone (handles DST)
      const targetUtcHour = getUtcHourForTimezone(hour, timezone, now);

      // Start with tomorrow
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(targetUtcHour, 0, 0, 0);

      // If the computed time is in the past (edge case near midnight), add a day
      if (tomorrow.getTime() <= now.getTime()) {
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      }
      return tomorrow;
    }
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

/**
 * Converts a local hour in a given timezone to UTC hour,
 * accounting for DST using Intl.DateTimeFormat.
 */
function getUtcHourForTimezone(localHour: number, timezone: string, referenceDate: Date): number {
  try {
    // Get the timezone offset by formatting a date in the target timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    });

    // Get current hour in the target timezone
    const parts = formatter.formatToParts(referenceDate);
    const tzHour = parseInt(parts.find(p => p.type === "hour")?.value || "0");

    // Compute offset: UTC hour = reference UTC hour, TZ hour = tzHour
    const utcHour = referenceDate.getUTCHours();
    const offset = tzHour - utcHour; // positive = ahead of UTC

    // Convert desired local hour to UTC
    const targetUtcHour = ((localHour - offset) % 24 + 24) % 24;
    return targetUtcHour;
  } catch {
    // Fallback: assume UTC if timezone is invalid
    console.warn(`Invalid timezone "${timezone}", falling back to UTC`);
    return localHour;
  }
}
