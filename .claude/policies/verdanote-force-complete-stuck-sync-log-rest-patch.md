---
id: verdanote-force-complete-stuck-sync-log-rest-patch
title: Force-completing a stuck sync log via direct REST PATCH is a valid recovery when stale selfContinue chains keep re-promoting a completed account
scope: repo
trigger: a sync_log row is stuck in `running` state but the underlying account is actually done, and stale selfContinue chains keep re-promoting it
enforcement: soft
public: false
version: 1
created: 2026-05-27
updated: 2026-05-27
source: session-learning
---

## Rule

ALWAYS: Force-completing a stuck sync log via direct REST PATCH (`status=completed_with_errors`) is a valid recovery when stale `selfContinue` chains keep re-promoting a completed account. Verify `sync_state` is clean (no in-progress cursors, no pending pagination tokens, no half-written aggregates) BEFORE force-completing — otherwise the next sync run will resume from a half-cooked checkpoint and corrupt downstream data.

## Rationale

Verdanote's queue runner uses `selfContinue` chains to keep an account's sync moving across function invocations. If a chain is created against a `sync_log` row that has actually finished work but never had its row flipped to a terminal state, the chain will keep re-firing forever — promoting an already-done account back into the active queue and blocking other tenants.

The clean fix (find the race condition and patch the writer) is correct long-term. The operational fix when production is on fire is to PATCH the row directly to `completed_with_errors` so the chain terminates. The `_with_errors` suffix preserves an audit trail that this was a forced recovery, not a normal completion.

Hard precondition: inspect `sync_state` first. A stuck-but-clean log can be safely force-completed; a stuck-and-dirty log needs cursor cleanup first or the next run replays corruption.
