---
id: verdanote-meta-permanent-errors-terminal-cap-retries
title: Meta permanent Graph errors are terminal; cap all retries
scope: repo
when: meta && (graph || sync || retry)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-10-02
updated: 2026-10-02
source: session-learning
---

## Rule

ALWAYS: Treat permanent Meta Graph errors on an account-scoped URL (code 100/subcode 33, 190, 10, 200-299) as terminal and fail the sync; cap every other retry path. The sync runner is single-lane, so one unbounded retry blocks every queued account (act_demo_glowdrip made 26k calls over 10h). Never queue demo/seed ids that do not match ^act_\d+$.

## Rationale

A single unbounded retry on a demo account id blocked the single-lane runner for 10 hours and made 26k calls.
