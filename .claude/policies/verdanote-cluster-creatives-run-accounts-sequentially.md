---
id: verdanote-cluster-creatives-run-accounts-sequentially
title: Run cluster-creatives across accounts sequentially with a delay — back-to-back fan-out causes transient contention failures
trigger: Kicking off cluster-creatives for multiple Verdanote accounts
when: cluster-creatives
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

Verdanote: firing cluster-creatives for all 12 accounts back-to-back caused ~7 accounts to fail transiently (server contention). Re-run sequentially with a small delay between calls; each returns {participants, clusters, effective_entities, tier_counts} on success — check ok:true. Small accounts that 'failed' succeed cleanly on a lone retry.

## Rationale

Captured as a session learning. Concurrent cluster-creatives invocations contend on the server, so a back-to-back fan-out over all 12 accounts saw ~7 transient failures. Serializing the runs with a small inter-call delay avoids the contention; a successful run returns {participants, clusters, effective_entities, tier_counts} and ok:true, and accounts that fail under the fan-out succeed on a solo retry.
