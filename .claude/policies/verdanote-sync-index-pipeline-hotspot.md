---
id: verdanote-sync-index-pipeline-hotspot
title: sync/index.ts is a pipeline hotspot — size sync-touching stories generously
scope: repo
trigger: planning or editing verdanoteanalytics sync / data-pipeline work
when: sync || pipeline || metafetch || rollup || creative_daily_metrics
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-14
updated: 2026-07-14
source: success-pattern
---

## Rule

Treat `supabase/functions/sync/index.ts` in verdanoteanalytics as an
architectural hotspot. The Meta fetch loop, incremental-window sizing, local
rollup call, and media-cache enqueue all live inside this one entrypoint, so it
is a tight coupling point:

- Size any story that touches `sync/index.ts` at **M or larger** — never S.
- Expect cross-story coupling: sequence sync-touching stories linearly and
  re-read the current file before editing rather than assuming prior structure.
- When adding a new concern to the sync flow, prefer extracting it into a pure,
  independently testable helper (as with `computeDailyWindowDays`,
  `newlyInsertedAdIds`, `rollupDailyRows`) instead of inlining more logic into
  the phase orchestration.

## Rationale

In the `long-horizon-retention` project (2026-07-14), `sync/index.ts` was
modified by 4 of 12 stories (US-002, US-003, US-008, US-011) — the single most
churned file, ~648 lines changed — while every other file was touched by at most
one or two stories. Underestimating a sync-touching story invites lock/coupling
surprises; the extract-a-pure-helper pattern kept each change testable and the
regression gates green throughout.
