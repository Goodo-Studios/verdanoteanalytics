---
id: verdanote-manual-migration-apply-single-transaction
title: Apply prod migrations by hand in one transaction from git show
scope: repo
when: (supabase && migration) || schema_migrations
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-10-02
updated: 2026-10-02
source: session-learning
---

## Rule

ALWAYS: When applying a Verdanoteanalytics migration to prod by hand with `supabase db query --linked -f`, build the SQL from `git show origin/<branch>:<path>`, confirm it is non-empty, and run the DDL and the supabase_migrations.schema_migrations insert in ONE transaction. Writing the ledger row in a separate step after a failed `cat` recorded the migration without applying it.

## Rationale

A failed cat followed by a separate ledger insert recorded a migration as applied when it was not.
