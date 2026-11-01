---
id: verdanote-media-crons-throttle-safe-re-enable
title: Keep Verdanote media crons throttle-safe on re-enable — scope the feeder, rely on the drain single-flight guard, do not let the feeder poke the drain
scope: repo
trigger: re-enabling Verdanote media pg_cron jobs, the refresh feeder (enqueue_media_refresh_candidates), or the drain (drain-media-queue) self-chain
when: verdanote && (cron || pg_cron || media || drain || feeder || throttle || queue || backfill)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-17
updated: 2026-07-17
source: session-learning
applies_to: [supabase, meta]
---

## Rule

ALWAYS: keep Verdanote media crons throttle-safe on re-enable: (1) scope the refresh feeder (enqueue_media_refresh_candidates) to ad_accounts.media_backfill_enabled accounts so the queue holds only resolvable ads; (2) rely on the drain single-flight guard (a chain=0 cron poke no-ops while fresh 'processing' rows <3min exist) so only ONE bounded ~500-ad self-chain runs at a time; (3) do NOT let the feeder poke the drain. Re-enabling both at full 2-min cadence WITH the feeder->drain poke re-throttled (drain returned throttled 4/5, cached 0). Also clear stale non-flagged pending rows before re-enabling — the drain claims media_cache_queue by status, not by account.

## Rationale

Captured from a Verdanote media-pull session. The media pipeline throttles Meta the moment more than one drain runs concurrently or the queue holds ads for accounts that cannot be resolved. Scoping the feeder to media_backfill_enabled accounts, leaning on the drain's single-flight guard (one bounded ~500-ad self-chain at a time), and preventing the feeder from poking the drain keep the re-enabled crons within Meta's rate budget. Because the drain claims media_cache_queue rows by status rather than by account, stale non-flagged pending rows must be cleared first or they get drained against the throttle budget.
