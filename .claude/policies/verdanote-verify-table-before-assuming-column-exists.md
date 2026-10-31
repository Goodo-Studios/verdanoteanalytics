---
id: verdanote-verify-table-before-assuming-column-exists
title: Confirm which table an ALTER/ADD COLUMN targets before assuming a column exists
scope: repo
trigger: Assuming a column exists on a table based on a grep of supabase/migrations, or building a PRD/run on that assumption
when: column || migration
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-18
updated: 2026-07-18
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS confirm which TABLE an ALTER/ADD COLUMN targets before assuming a column exists. Verify the exact table, not just that the column name appears somewhere in `supabase/migrations`.

## Rationale

A broad `grep 'add column transcript'` across `supabase/migrations` matched `ad_library_saved_ads` (not `creatives`), and the PRD wrongly claimed `creatives` had `transcript`/`transcript_status`. Building on that assumption failed a live prod run with 'Could not find the transcript column'. A column name appearing in the migrations tree does not mean it exists on the table you care about — confirm the target table of each `ADD COLUMN` before relying on it.
