import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// US-010: SIMPLIFIED — the recurring cleanup cron for this function has been RETIRED.
//
// This function existed solely to release media_refresh_logs rows stranded in
// 'running' when a media worker died mid-flight (e.g. an OOM / WORKER_RESOURCE_LIMIT
// on a large video), which blocked enrich-thumbnails' per-account concurrency guard.
// The in-stack video download QUEUE (US-010: drain-media-queue + media_cache_queue)
// removes that failure mode entirely:
//   * heavy downloads are drained by a queue-backed, self-chaining worker whose
//     claim RPC (claim_media_cache_queue) self-heals a dead claim by requeuing any
//     row stuck in 'processing' > 5 min — so nothing gets permanently stranded, and
//   * the every-2-min cleanup-stuck-media cron is unscheduled in the companion
//     migration (20260714000008_drain_media_queue_worker.sql).
//
// The function directory is KEPT (not deleted) so it remains available for a manual
// one-off sweep of any legacy 'running' log left over from before the cutover, and so
// its scripts/deploy-functions.sh + supabase/config.toml entries stay valid (deleting
// the directory would trigger verdanote-supabase-config-toml-audit-on-function-
// deletion). It is simply no longer on any schedule.
//
// Behavior unchanged when invoked manually: mark any media_refresh_logs row stuck in
// 'running' > 3 min (edge fns hard-cap at 150s) as 'failed'. Idempotent; returns the
// count cleaned.

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const staleThreshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const { data: stuck } = await supabase
    .from("media_refresh_logs")
    .select("id, started_at")
    .eq("status", "running")
    .lt("started_at", staleThreshold);

  if (!stuck?.length) {
    return new Response(JSON.stringify({ cleaned: 0, note: "cron retired — superseded by drain-media-queue (US-010)" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase
    .from("media_refresh_logs")
    .update({
      status: "failed",
      api_errors: JSON.stringify([{ timestamp: now, message: "Media refresh timed out (manual cleanup — cron retired US-010)" }]),
      completed_at: now,
    })
    .in("id", stuck.map((s: { id: string }) => s.id));

  console.log(`Cleaned up ${stuck.length} stuck media refresh(es) [manual — cron retired US-010]`);

  return new Response(JSON.stringify({ cleaned: stuck.length, note: "cron retired — superseded by drain-media-queue (US-010)" }), {
    headers: { "Content-Type": "application/json" },
  });
});
