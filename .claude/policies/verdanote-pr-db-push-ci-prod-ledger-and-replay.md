---
id: verdanote-pr-db-push-ci-prod-ledger-and-replay
title: Before merging PRs that add CI db push, reconcile prod ledger and check replay
scope: repo
when: (verdanoteanalytics || verdanote) && (merge || db_push || migration)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-10-02
updated: 2026-10-02
source: session-learning
---

## Rule

ALWAYS: Before merging a Verdanoteanalytics PR whose CI adds an automatic `supabase db push` to the deploy job, remember prod migrations stay manual until the prod ledger is reconciled. Also confirm clean-database migration replay passes: client-specific override migrations that insert naming_conventions rows must skip when the ad_accounts row is absent.

## Rationale

Automatic db push against an unreconciled prod ledger is unsafe, and client-specific overrides break clean replays.
