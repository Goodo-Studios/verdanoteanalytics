import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req) => {
  // Auth: Supabase gateway validates the JWT/apikey before reaching this function.
  // Cron calls use the project anon key which passes gateway validation.

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const activityThreshold = Date.now() - 2 * 60 * 1000; // 2 min no heartbeat = stuck
  const now = new Date().toISOString();

  // Only clean up "running" syncs — "queued" syncs are intentionally waiting
  const { data: candidates } = await supabase
    .from("sync_logs")
    .select("id, sync_state, started_at")
    .eq("status", "running")
    .lt("started_at", threeMinAgo);

  if (!candidates?.length) {
    return new Response(JSON.stringify({ cleaned: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Mark as stuck if no heartbeat in 2 min, OR if running for over 1 hour regardless
  const trulyStuck = candidates.filter((s: any) => {
    const startedAt = new Date(s.started_at || 0).getTime();
    // If running for over 1 hour, always consider stuck
    if (startedAt < new Date(oneHourAgo).getTime()) return true;
    const lastActivity = s.sync_state?.last_activity;
    if (lastActivity && new Date(lastActivity).getTime() > activityThreshold) return false;
    return true;
  });

  if (!trulyStuck.length) {
    return new Response(JSON.stringify({ cleaned: 0, skipped: candidates.length }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase
    .from("sync_logs")
    .update({
      status: "failed",
      api_errors: JSON.stringify([{ timestamp: now, message: "Sync timed out (auto-cleanup)" }]),
      completed_at: now,
    })
    .in("id", trulyStuck.map((s: any) => s.id));

  // After cleaning up stuck syncs, promote the next queued sync
  const { data: nextQueued } = await supabase
    .from("sync_logs")
    .select("id")
    .eq("status", "queued")
    .order("started_at", { ascending: true })
    .limit(1);
  if (nextQueued?.length) {
    await supabase.from("sync_logs").update({
      status: "running",
      sync_state: { last_activity: now },
    }).eq("id", nextQueued[0].id);
    console.log(`Promoted queued sync ${nextQueued[0].id} after cleanup`);
  }

  console.log(`Cleaned up ${trulyStuck.length} stuck sync(s), skipped ${candidates.length - trulyStuck.length} active`);

  return new Response(JSON.stringify({ cleaned: trulyStuck.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
