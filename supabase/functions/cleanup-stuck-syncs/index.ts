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
  const now = new Date().toISOString();

  // Absolute backstop — NOT a normal liveness signal.
  // Liveness is determined by heartbeat staleness (see activityThreshold below):
  // large accounts can legitimately sync for many hours, and a fresh heartbeat
  // means the sync is still making real progress, so total wall-clock time must
  // NOT mark a progressing sync as stuck (the old 2h cap force-failed them).
  // This 24h cap exists only to catch a pathological sync that keeps emitting a
  // heartbeat but never advances — far beyond any legitimate run.
  const absoluteCapMs = Date.now() - 24 * 60 * 60 * 1000;

  // 5-minute heartbeat threshold for phases 2-5.
  // Previously 2 min — too tight against the 2-min cron cycle, causing a race where
  // cleanup would declare a sync dead just as continue-sync-queue was about to rescue it.
  // selfContinue() is fire-and-forget; if it drops, the cron needs ~2 cycles (4 min) to
  // pick it back up. 5 min gives 2+ full rescue windows before cleanup fires.
  const activityThreshold = Date.now() - 5 * 60 * 1000;

  // Phase 1 gets 40 min for large account metadata fetching with rate limit backoffs
  const phase1ExtendedThreshold = Date.now() - 40 * 60 * 1000;

  // Max retries before a sync is declared terminally failed
  const MAX_RETRIES = 3;

  // Only clean up "running" syncs started > 3 min ago (avoids catching syncs still warming up)
  const { data: candidates } = await supabase
    .from("sync_logs")
    .select("id, sync_state, started_at, current_phase, api_errors")
    .eq("status", "running")
    .lt("started_at", threeMinAgo);

  if (!candidates?.length) {
    return new Response(JSON.stringify({ cleaned: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Mark as stuck only if the heartbeat is stale (the sync has stalled).
  // A fresh heartbeat means the sync is still progressing, so it is NOT stuck
  // no matter how long it has been running — large accounts take hours.
  const trulyStuck = candidates.filter((s: any) => {
    const startedAt = new Date(s.started_at || 0).getTime();
    const lastActivity = s.sync_state?.last_activity;
    const effectiveThreshold =
      s.current_phase === 1 ? phase1ExtendedThreshold : activityThreshold;
    // Fresh heartbeat → still progressing → not stuck, UNLESS it has blown past
    // the 24h absolute backstop (pathological heartbeat-forever loop).
    if (lastActivity && new Date(lastActivity).getTime() > effectiveThreshold) {
      return startedAt < absoluteCapMs;
    }
    return true;
  });

  if (!trulyStuck.length) {
    return new Response(
      JSON.stringify({ cleaned: 0, skipped: candidates.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Separate retryable from terminal.
  // Retryable: phases 2-5, under retry cap, not wall-clock expired.
  // selfContinue dropping is the common cause — re-queuing is safe because sync_state
  // preserves the resumable cursor, so the sync picks up from where it left off.
  const retryable: any[] = [];
  const terminal: any[] = [];

  for (const s of trulyStuck) {
    const startedAt = new Date(s.started_at || 0).getTime();
    // Only the 24h absolute backstop forces a sync terminal on time alone.
    // Everything else is retryable (bounded by MAX_RETRIES): a stalled sync
    // resumes from its preserved sync_state cursor, so requeuing is safe.
    const isWallClockExpired = startedAt < absoluteCapMs;
    const retryCount = s.sync_state?.retry_count ?? 0;

    // A phase-1 sync is retryable if it has no real Meta API errors —
    // only cleanup/requeue bookkeeping messages, meaning it was a dropped
    // selfContinue rather than a genuine permission or data failure.
    const hasRealApiErrors = parseErrors(s.api_errors).some(
      (e: any) =>
        !e.message.includes("Auto-requeued") && !e.message.includes("auto-cleanup")
    );

    if (
      !isWallClockExpired &&
      retryCount < MAX_RETRIES &&
      (s.current_phase > 1 || !hasRealApiErrors)
    ) {
      retryable.push(s);
    } else {
      terminal.push(s);
    }
  }

  // Re-queue retryable syncs — preserve existing sync_state cursor and append to api_errors
  for (const s of retryable) {
    const existingErrors = parseErrors(s.api_errors);
    const retryCount = (s.sync_state?.retry_count ?? 0) + 1;

    await supabase
      .from("sync_logs")
      .update({
        status: "queued",
        // Merge into existing sync_state — preserves resumable cursor
        sync_state: { ...s.sync_state, last_activity: now, retry_count: retryCount },
        // Append, not replace — preserve previous error history
        api_errors: JSON.stringify([
          ...existingErrors,
          {
            timestamp: now,
            message: `Auto-requeued after heartbeat timeout (retry ${retryCount}/${MAX_RETRIES}, phase ${s.current_phase})`,
          },
        ]),
      })
      .eq("id", s.id);

    console.log(
      `Auto-requeued sync ${s.id} at phase ${s.current_phase} (retry ${retryCount}/${MAX_RETRIES})`
    );
  }

  // Mark terminal syncs as failed — append to api_errors
  for (const s of terminal) {
    const existingErrors = parseErrors(s.api_errors);

    await supabase
      .from("sync_logs")
      .update({
        status: "failed",
        api_errors: JSON.stringify([
          ...existingErrors,
          { timestamp: now, message: "Sync timed out (auto-cleanup)" },
        ]),
        completed_at: now,
      })
      .eq("id", s.id);
  }

  // Promote the next queued sync after cleanup.
  // Use spread to merge into existing sync_state rather than replacing it —
  // a re-queued retry may have a resumable cursor we must not wipe.
  const { data: nextQueued } = await supabase
    .from("sync_logs")
    .select("id, sync_state")
    .eq("status", "queued")
    .order("started_at", { ascending: true })
    .limit(1);

  if (nextQueued?.length) {
    const existingState = nextQueued[0].sync_state ?? {};
    await supabase
      .from("sync_logs")
      .update({
        status: "running",
        sync_state: { ...existingState, last_activity: now },
      })
      .eq("id", nextQueued[0].id);
    console.log(`Promoted queued sync ${nextQueued[0].id} after cleanup`);
  }

  console.log(
    `Cleanup: ${retryable.length} requeued, ${terminal.length} failed, ${candidates.length - trulyStuck.length} skipped`
  );

  return new Response(
    JSON.stringify({
      requeued: retryable.length,
      failed: terminal.length,
      skipped: candidates.length - trulyStuck.length,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});

function parseErrors(raw: unknown): Array<{ timestamp: string; message: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
