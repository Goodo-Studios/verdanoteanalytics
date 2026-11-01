---
id: verdanote-never-bulk-migration-repair-reverted
title: NEVER run the CLI-suggested `supabase migration repair --status reverted <all ids>` — it un-applies applied migrations and risks re-running the whole history
scope: repo
trigger: the verdanoteanalytics Supabase CLI prints "Remote migration versions not found" and suggests a bulk `migration repair --status reverted <all ids>` command
when: (supabase || migration || repair || reverted) && (repair || reverted || push || migration)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: hard
public: false
version: 1
created: 2026-08-08
updated: 2026-08-08
source: session-learning
applies_to: [supabase]
---

## Rule

NEVER run the `supabase migration repair --status reverted <all ids>` command the CLI suggests after 'Remote migration versions not found' — it marks applied migrations un-applied and risks re-running the whole history. That error usually just means `supabase db push` ran from the wrong directory; run it from the repo root.

## Rationale

Captured as a verdanoteanalytics session learning. The CLI's "Remote migration versions not found" message helpfully prints a bulk `migration repair --status reverted` command covering every id, but running it rewrites the migration ledger to treat already-applied migrations as reverted — inviting a full re-run of migration history against prod. The message is usually a false alarm caused by invoking `supabase db push` from the wrong working directory; running push from the repo root resolves it without touching the ledger. (Distinct from `verdanote-db-push-matches-by-version-number-collision-skips`, which reconciles a SINGLE orphan version — never the bulk all-ids form.)
