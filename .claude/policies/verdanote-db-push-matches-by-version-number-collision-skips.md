---
id: verdanote-db-push-matches-by-version-number-collision-skips
title: supabase db push matches migrations by version number — a remote-vs-local collision silently skips your new migration
scope: repo
trigger: A new verdanoteanalytics migration silently fails to apply via `supabase db push`, or a remote ledger version exists with no matching local file
when: (supabase || migration) && (push || migration || repair)
on: [PreToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-10-31
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: `supabase db push` matches migrations by VERSION NUMBER, not content. A remote-vs-local version collision (remote had 20260602000007 applied with no matching local file) makes push silently skip your new same-numbered migration. Fix: renumber to a free slot AND `supabase migration repair --status reverted <orphan-version>` to reconcile the history table before pushing. CI deploys edge functions only (scripts/deploy-functions.sh) — migrations are a manual `db push`.

## Rationale

`supabase db push` keys on the migration version number, not on file content. When the remote ledger already records a version (e.g. `20260602000007`) for which there is no matching local file, a new local migration that reuses that same number is treated as already-applied and silently skipped — the DDL never runs and the push reports success. The fix has two parts: renumber the new migration to a free slot so it is no longer shadowed, AND run `supabase migration repair --status reverted <orphan-version>` to remove the orphan ledger row that no longer corresponds to any local migration. Note CI only deploys edge functions via `scripts/deploy-functions.sh`; migrations are always a manual `db push`.
