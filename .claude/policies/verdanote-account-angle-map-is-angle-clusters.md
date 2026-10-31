---
id: verdanote-account-angle-map-is-angle-clusters
title: Account angle map IS angle_clusters — no parallel account_angles table
scope: repo
trigger: When working on Verdanote strategy-layer features touching account angle data
when: angle || strategy-layer || account_angles || angle_clusters
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-02
updated: 2026-07-02
source: session-learning
---

## Rule

ALWAYS: for Verdanote strategy-layer work, the account angle map IS angle_clusters (extended with test_status/status_override) — do not create a parallel account_angles table. Decision locked in account-strategy-layer PRD 2026-07-02.

## Rationale

Captured from the account-strategy-layer handoff session (2026-07-02). The account-strategy-layer PRD locked the decision that the existing angle_clusters table, extended with test_status and status_override columns, serves as the account angle map. Creating a parallel account_angles table would duplicate state and drift from the locked schema decision.
