---
id: verdanote-creatives-triggers-statement-level-not-row
title: Verdanote creatives triggers must be statement-level
scope: repo
when: trigger && (creatives || rollup_creatives_from_daily)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-10-02
updated: 2026-10-02
source: session-learning
---

## Rule

ALWAYS: In Verdanote Postgres, put row-count/denormalization triggers on public.creatives at statement level (AFTER INSERT/UPDATE/DELETE with REFERENCING transition tables, FOR EACH STATEMENT), never FOR EACH ROW. rollup_creatives_from_daily updates every creative in an account in one statement; a per-row trigger that recounted the account made a 9,346-creative account exceed the 8s statement timeout while holding the ad_accounts row lock, so last_synced_at never saved. Only write ad_accounts when a count actually changed.

## Rationale

Observed in a Verdanote sync failure: the per-row recount held the ad_accounts lock past the statement timeout, so sync state never persisted.
