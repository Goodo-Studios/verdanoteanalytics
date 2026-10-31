---
id: verdanote-cluster-creatives-onsquared-active-scoping-ann
title: cluster-creatives is O(n^2) single-linkage in one invocation — active-only scoping keeps it tractable; ANN is the upgrade point
trigger: Reasoning about cluster-creatives runtime/scale, or if active-set sizes grow large
when: cluster-creatives || clustering || single-linkage || ANN
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

Verdanote cluster-creatives clustering is O(n^2) single-linkage in one edge invocation (header flags it 'Phase-2 can swap in ANN'); active-only scoping keeps each account's set small enough to finish. If active counts ever exceed a few thousand and runs get slow, that's the ANN/blocking upgrade point.

## Rationale

Captured as a session learning. The clustering step is O(n^2) single-linkage executed inside a single edge invocation, so its runtime is bounded by how many creatives it clusters. Restricting to active ads (see the active-ads-only invariant) keeps each account's set small enough to finish within the edge timeout; the code header already notes Phase-2 can swap in ANN, which is the upgrade to make once active counts push past a few thousand and runs slow down.
