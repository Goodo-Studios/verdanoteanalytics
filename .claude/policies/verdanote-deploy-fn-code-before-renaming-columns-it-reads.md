---
id: verdanote-deploy-fn-code-before-renaming-columns-it-reads
title: Deploy updated edge-function code before renaming or dropping columns the running function reads
scope: repo
trigger: A verdanoteanalytics migration renames or drops DB columns that a live edge function (e.g. drain-media-queue cron) reads
when: supabase && (migration || column || rename)
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

NEVER rename/drop DB columns that live edge functions read before deploying the updated function code: renaming creatives capture columns out from under the running drain-media-queue cron broke it until redeploy. Deploy code first (or add columns additively), then migrate.

## Rationale

Captured during a verdanote creative-capture session. A migration renamed creatives-capture columns while the `drain-media-queue` cron was still running the OLD function code that queried the OLD column names. The cron broke immediately and stayed broken until the function was redeployed. The safe ordering is code-first: deploy the edge function that reads the new schema before (or add columns additively so both old and new code work, then) applying the destructive rename/drop. Companion: `verdanote-ci-deploy-ships-functions-not-migrations` (migrations are a separate manual `db push` step).
