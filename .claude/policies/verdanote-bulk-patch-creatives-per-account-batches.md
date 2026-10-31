---
id: verdanote-bulk-patch-creatives-per-account-batches
title: Do bulk maintenance PATCHes on public.creatives per-account in smaller batches — compound filters over thousands of rows 500
trigger: Running a maintenance UPDATE/PATCH over public.creatives with a compound filter spanning many rows
when: (creatives && (patch || bulk || update || maintenance)) || cluster_id
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
scope: repo
enforcement: soft
public: false
version: 1
created: 2026-07-23
updated: 2026-07-23
source: session-learning
applies_to: [supabase]
---

## Rule

Verdanote: a bulk PATCH on public.creatives with a compound filter over thousands of rows (e.g. ad_status=neq.ACTIVE&cluster_id=not.is.null) can return HTTP 500 (lock/statement-timeout, worse under concurrent clustering writes). Do such maintenance updates PER-ACCOUNT in smaller batches — they return 204.

## Rationale

Captured as a session learning. A single compound-filter PATCH across thousands of creatives rows hits lock/statement-timeout and returns HTTP 500, especially when clustering writes are running concurrently. Scoping the maintenance update per-account into smaller batches keeps each write inside limits and returns 204.
