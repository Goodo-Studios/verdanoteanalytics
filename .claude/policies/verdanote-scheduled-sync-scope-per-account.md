---
id: verdanote-scheduled-sync-scope-per-account
title: Pick scheduled-sync scope per account — full scope wedges large accounts
scope: repo
trigger: configuring, re-registering, or debugging Verdanote scheduled-sync cron jobs or a stalled sync queue
when: verdanote && (scheduled-sync || sync-queue || last_full_sync_at || cleanup-stuck || wedged || stall)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-21
updated: 2026-07-21
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS pick scheduled-sync scope per account in Verdanote: large accounts (~3.7k+ creatives) wedge phase-1 on full scope. Steady-state is daily scope `[4,5]` with a ~20h full-refresh escalation via `last_full_sync_at`. The serial sync queue stalls entirely behind one wedged run unless cleanup-stuck-syncs is scheduled — keep that job registered alongside scheduled-sync.

## Rationale

Running full-scope scheduled syncs against large accounts wedged phase-1, and because the sync queue is serial, one wedged run blocked every other account's sync. The working configuration is per-account scoping: daily incremental scope `[4,5]` as steady state, escalating to a full refresh when `last_full_sync_at` exceeds ~20h, with cleanup-stuck-syncs scheduled as the safety net that clears wedged runs so the queue keeps moving.
