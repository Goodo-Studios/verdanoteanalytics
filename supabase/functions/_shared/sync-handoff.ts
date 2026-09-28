// Timing helpers for handing the sync queue from one account to the next.
// Deno-free so vitest can import it.
//
// Background (2026-09-28): when a sync finished inside the between-account
// cooldown, promoteNextQueued returned without promoting and nothing re-fired
// /continue, so the queue sat idle until an external cron happened to kick it.
// The /continue handler now waits out the cooldown itself and re-fires.

/** Longest a single /continue invocation sleeps waiting for the cooldown.
 *  Keeps the invocation well under the ~150s edge-function wall-clock limit;
 *  longer cooldowns are covered by re-firing /continue after each wait. */
export const COOLDOWN_WAIT_CAP_MS = 60_000;

/** Milliseconds left in the between-account cooldown (0 when it has passed). */
export function cooldownRemainingMs(
  lastCompletedAt: string | null | undefined,
  cooldownMinutes: number,
  nowMs: number,
): number {
  if (!lastCompletedAt || !(cooldownMinutes > 0)) return 0;
  const completedMs = new Date(lastCompletedAt).getTime();
  if (Number.isNaN(completedMs)) return 0;
  return Math.max(0, completedMs + cooldownMinutes * 60_000 - nowMs);
}

/** How long to sleep before re-trying promotion: the remaining cooldown plus
 *  a 1s margin, capped at COOLDOWN_WAIT_CAP_MS. */
export function cooldownWaitMs(remainingMs: number): number {
  return Math.min(Math.max(0, remainingMs) + 1000, COOLDOWN_WAIT_CAP_MS);
}
