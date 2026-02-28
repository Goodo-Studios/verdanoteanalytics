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

    // Find accounts due for sync
    const now = new Date().toISOString();
    const { data: dueAccounts, error: queryError } = await supabase
      .from("ad_accounts")
      .select("id, name, sync_frequency, sync_hour, sync_timezone, next_sync_at, last_synced_at")
      .neq("sync_frequency", "manual")
      .eq("is_active", true)
      .or(`next_sync_at.is.null,next_sync_at.lte.${now}`);

    if (queryError) {
      console.error("Error querying accounts:", queryError);
      return new Response(JSON.stringify({ error: queryError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!dueAccounts || dueAccounts.length === 0) {
      return new Response(JSON.stringify({ triggered: 0, message: "No accounts due for sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const triggered: string[] = [];

    for (const account of dueAccounts) {
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

        // Calculate next_sync_at based on frequency
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
      // Next occurrence of the specified hour in the account's timezone
      // Simple approach: add 24h from now, then adjust to the target hour
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      // Use UTC approximation — timezone offset applied for common US timezones
      const tzOffsets: Record<string, number> = {
        "America/New_York": -5,
        "America/Chicago": -6,
        "America/Denver": -7,
        "America/Los_Angeles": -8,
        "America/Phoenix": -7,
        "UTC": 0,
        "Europe/London": 0,
        "Europe/Berlin": 1,
        "Australia/Sydney": 11,
      };
      const offset = tzOffsets[timezone] ?? -5;
      const targetUtcHour = ((hour - offset) % 24 + 24) % 24;
      tomorrow.setUTCHours(targetUtcHour, 0, 0, 0);
      // If this time already passed today, it'll be tomorrow which is correct
      if (tomorrow.getTime() <= now.getTime()) {
        tomorrow.setTime(tomorrow.getTime() + 24 * 60 * 60 * 1000);
      }
      return tomorrow;
    }
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}
