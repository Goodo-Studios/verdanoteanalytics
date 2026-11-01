---
id: verdanote-edge-backfill-loop-retry-on-deadline-timeout
title: Drive Verdanote edge backfills in a retry loop — they overrun DEADLINE_MS but commit progressively
scope: repo
trigger: Running a Verdanote edge backfill (backfill-ai-tags, etc.) that times out the HTTP client mid-run
when: backfill || DEADLINE || timeout || cursor
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

Verdanote edge backfills (backfill-ai-tags, etc.) overrun their own DEADLINE_MS (~50s) and the HTTP client times out (curl exit 28, 0 bytes), but they commit progressively and are idempotent+re-runnable — so drive them in a loop that retries the same cursor on timeout and polls a dry_run count for 'remaining', rather than trusting a single response.

## Rationale

Captured as a session learning. These backfills exceed their own ~50s DEADLINE_MS, so the HTTP client times out (curl exit 28, empty body) before a response returns — but the function commits progress incrementally and is idempotent and re-runnable. Trusting a single response is misleading; instead loop, retry the same cursor after a timeout, and poll a dry_run count for the number 'remaining' to know when the backfill is actually done.
