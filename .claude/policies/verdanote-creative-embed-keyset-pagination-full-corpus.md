---
id: verdanote-creative-embed-keyset-pagination-full-corpus
title: Full-corpus edge backfills need deterministic keyset pagination, not select().limit()
scope: repo
trigger: Writing or reviewing a Verdanote edge-function backfill that must sweep the full creative corpus (e.g. creative-embed force re-embed)
when: creative-embed || embed || backfill || pagination
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

verdanoteanalytics creative-embed originally did .select().limit(N) with NO order/offset, so a force re-embed re-returned the same first N rows and never advanced past 2000 (5 accounts exceed that). Any full-corpus edge-function backfill needs deterministic keyset pagination (order by ad_id + `after` cursor returning next_cursor/done). Fixed in PR #94.

## Rationale

Captured as a session learning (fixed in PR #94). A `.select().limit(N)` with no ordering or cursor is non-deterministic and re-reads the same first N rows on every invocation, so a force re-embed silently stalls at 2000 rows and never reaches accounts that exceed that. Deterministic keyset pagination (order by `ad_id`, `after` cursor, return `next_cursor`/`done`) guarantees the sweep advances through the entire corpus.
