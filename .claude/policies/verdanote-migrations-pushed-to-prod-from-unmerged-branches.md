---
id: verdanote-migrations-pushed-to-prod-from-unmerged-branches
title: Verdanote — migrations get pushed to prod from unmerged feature branches; never assume main==prod migration state
scope: repo
trigger: reasoning about Verdanote prod schema / migration state, or before assuming main matches prod migrations
when: verdanote && (migration || migrations || prod || schema_migrations || db)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-16
updated: 2026-07-16
source: session-learning
applies_to: [supabase]
---

## Rule

WATCH (verdanote): migrations have been applied to production from UNMERGED feature branches (e.g. feature/creative-intelligence pushed 031/032/033 to prod before merge), leaving prod schema_migrations ahead of main and applying unreviewed schema. Never assume main==prod migration state; always check `supabase migration list --linked`. Flag out-of-order pre-merge `db push` to the branch owner.

## Rationale

Captured as a verdanote session learning. Because devs run `supabase db push` from unmerged feature branches, prod's `schema_migrations` can be ahead of main and can carry schema that was never reviewed on a merged PR. Treating main as ground truth for prod migration state is therefore unsafe — `supabase migration list --linked` is the real check, and out-of-order pre-merge pushes should be flagged to the branch owner.
