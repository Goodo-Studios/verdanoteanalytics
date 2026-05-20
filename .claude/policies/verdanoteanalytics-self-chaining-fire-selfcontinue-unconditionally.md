---
id: verdanoteanalytics-self-chaining-fire-selfcontinue-unconditionally
title: Fire selfContinue() unconditionally after runSyncPhase in self-chaining Edge Functions
scope: repo
trigger: editing a Supabase Edge Function that self-chains via selfContinue() between sync phases or queued accounts
enforcement: hard
public: false
version: 1
created: 2026-05-19
updated: 2026-05-19
source: session-learning
applies_to: [supabase]
---

## Rule

In Supabase Edge Function self-chaining pipelines (e.g. the Verdanote sync orchestrator), ALWAYS fire `selfContinue()` unconditionally after `runSyncPhase` returns. Do NOT gate it on the current sync still being in the `running` state.

When a sync completes, `promoteNextQueued()` is called inside `saveState()` and promotes the next queued account to `running`. If the caller only fires `selfContinue()` on the "still running" branch (e.g. `if (state.status === 'running') selfContinue()`), the freshly-promoted account is orphaned — it sits at `running` with no scheduled invocation to advance it, and the queue stalls until a manual unstuck.

## Rationale

The self-chaining loop is the only mechanism that keeps the queue draining. `promoteNextQueued()` mutates queue state but does not itself trigger the next Edge Function invocation; that responsibility belongs to the caller. Gating `selfContinue()` on the prior status assumes the only reason to continue is "this sync still has work," but queue-level continuation is just as important. The correct invariant is: as long as ANY account is in `running` (whether the same one or a newly-promoted one), the function must self-chain. Firing unconditionally is the simplest way to encode that — `selfContinue()` is cheap, idempotent at the queue level, and the next invocation will short-circuit cleanly if the queue is truly empty.

This rule was learned from the 2026-05-19 Verdanote sync queue stall incident, where a sync completed, the next account was promoted to `running`, but `selfContinue()` was skipped because the just-completed sync was no longer `running`. The promoted account stalled for hours until manually kicked.

## Examples

**Correct:**

```ts
await runSyncPhase(...);
await selfContinue();  // unconditional — promoted accounts get picked up
```

**Incorrect:**

```ts
const state = await runSyncPhase(...);
if (state.status === 'running') {
  await selfContinue();  // BUG — orphans freshly-promoted queue entries
}
```
