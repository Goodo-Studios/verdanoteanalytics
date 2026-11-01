---
id: verdanote-audit-live-cron-jobs-against-migration-intent
title: Audit live cron.job against migration intent when data goes stale
scope: repo
trigger: anything data-shaped goes stale in Verdanote (sync history gaps, undrained queues, stuck rows), or investigating a silent pipeline outage
when: verdanote && (cron || pg_cron || stale || scheduled-sync || backfill || drain)
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

ALWAYS audit live `cron.job` against migration intent when anything data-shaped goes stale in Verdanote. Re-registration of pg_cron jobs must live in migrations, and a self-terminating cron that is absent is only legitimate if its termination condition (e.g. zero undrained rows) actually holds — verify the condition, do not assume the absence is intentional.

## Rationale

A pg_cron wipe silently deleted 4 jobs (scheduled-sync, cleanup-stuck-syncs, backfill-daily-history, landing-pages-destkey-drain), and the Coda crons masked the outage — data staleness was the only visible symptom. Because job registration was not durably owned by migrations, the wipe left no drift signal. Comparing the live `cron.job` table against what migrations intend to exist catches this class of silent outage immediately.
