---
id: verdanote-cluster-creatives-batch-before-full-account
title: Batch cluster-creatives upserts before running entity resolution beyond the builder account
scope: repo
trigger: Running cluster-creatives / entity resolution on an account larger than the builder account, or reviewing its per-entity upsert loop
when: cluster-creatives || creatives
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

`cluster-creatives` does sequential per-entity upserts + per-member stamps (~80s for 334 creatives). This will exceed the ~150s edge-function timeout on a full account (~5.4k creatives). Batch the entity upserts + member stamps (or chunk/self-chain the run) before running entity resolution beyond the builder account.

## Rationale

The sequential per-entity upsert + per-member stamp loop measured ~80s for 334 creatives on the builder account. Linearly, a full account of ~5.4k creatives will blow past the ~150s edge-function timeout, so entity resolution cannot be run as-is beyond the builder account. Convert the per-entity upserts and per-member stamps to batched writes, or chunk/self-chain the run across invocations, before pointing it at a full account.
