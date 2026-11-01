---
id: verdanote-cluster-creatives-timeout-finishes-server-side
title: cluster-creatives finishes server-side even when the client curl times out — verify the DB, don't re-run blindly
trigger: A cluster-creatives (or edge backfill) call times out client-side with 0 bytes / curl exit 28
scope: repo
when: cluster-creatives || creative_clusters
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-23
updated: 2026-07-23
source: session-learning
applies_to: [supabase]
---

## Rule

Verdanote cluster-creatives (and the edge backfills) FINISH SERVER-SIDE even when the client curl times out with 0 bytes (exit 28) — the edge function keeps running past the ~150s client cutoff and commits. NEVER treat a client timeout as failure; verify the DB (cluster_id coverage / creative_clusters rows) before re-running.

## Rationale

Captured as a session learning. The edge function outlives the ~150s HTTP client cutoff, so curl returns exit 28 with an empty body while the run keeps going and commits its results. Re-running on the assumption it failed wastes work and can cause contention; instead check cluster_id coverage and creative_clusters rows in the DB to confirm whether the run actually completed.
