---
id: verdanote-sync-stall-check-dual-runner-cas-race
title: When diagnosing a sync/queue stall, check for RUNNING=2 (dual-runner) not just RUNNING=0
scope: repo
trigger: diagnosing a stalled or stuck sync/queue worker, or designing a CAS lock for a sync runner
enforcement: soft
public: false
version: 1
created: 2026-05-27
updated: 2026-05-27
source: session-learning
---

## Rule

ALWAYS: When diagnosing a sync/queue stall, check for `RUNNING=2` (dual-runner race) — not just `RUNNING=0`. A compare-and-swap that only tests `.eq('status', 'running')` without mutating a unique field allows two concurrent callers to both pass the check and both think they own the lock. The write must change a unique field (nonce, claim_id, generation counter) so a second concurrent caller detects the race and bails out.

## Rationale

A stall investigation that only looks for "nobody is running" misses the more common production failure mode: two runners both believe they're the owner, fight over cursors/state, and stomp on each other's progress. The CAS pattern `update where status=running` is non-atomic for ownership because the row is *already* `running` in both branches — the write succeeds for both callers. Only changing a unique discriminator (`claim_id = new_uuid()` with a where-clause that also tests the *prior* claim_id) makes the lock actually exclusive.

Verdanote's sync runner showed both symptoms in production: queued accounts stuck while a `selfContinue` loop chained on top of an already-completed sync log because two runner instances had both claimed the work. Diagnosis must always check both `RUNNING=0` (no one working) and `RUNNING=2` (too many working).
