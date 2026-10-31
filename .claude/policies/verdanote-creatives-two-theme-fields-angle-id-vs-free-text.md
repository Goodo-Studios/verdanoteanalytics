---
id: verdanote-creatives-two-theme-fields-angle-id-vs-free-text
title: verdanoteanalytics creatives has TWO theme fields — free-text theme vs angle_id FK — and the Creative Matrix keys on angle_id
scope: repo
trigger: When working on verdanoteanalytics creative tagging, the Creative Matrix Theme/Persona axis, or debugging why matrix cells render all-Untagged
when: theme || angle_id || creative-matrix || angle_clusters || resolveAngleReference || saveGovernedTags || backfill-retag
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-01
updated: 2026-08-01
source: session-learning
relates_to: [verdanote-e2e-green-not-proof-when-tests-fake-tagging-inputs, verdanote-account-angle-map-is-angle-clusters, verdanote-creative-matrix-combined-theme-persona-axis]
---

## Rule

KNOWLEDGE: verdanoteanalytics `creatives` has TWO theme fields:

- Free-text `theme` — filled by the ad-name parser, CSV map, AI layer, backfill-retag, and manual edits.
- `angle_id` FK → `angle_clusters` — filled ONLY by manual `saveGovernedTags` in `src/features/creative-library/api.ts`.

The Creative Matrix Theme/Persona axis keys on `angle_id`, so accounts tagged only via the free-text `theme` show all-Untagged. `resolveAngleReference` in `_shared/resolve-tags.ts` can convert `theme` → `angle_id`, but it is wired into NO write path (tests only). The US-005 backfill fills `creative_type`/`creative_lane` but NOT `angle_id`.

## Rationale

Captured from the Creative Matrix handoff session (2026-08-01). The matrix rendered empty in prod because real pipeline tagging populates `theme` (free-text) while the matrix reads `angle_id`, and the only `angle_id` writer is the manual governed-tags save. Knowing the two-field split — and that `resolveAngleReference` exists but is unwired — is required to diagnose empty matrices and to fix the pipeline (wire theme→angle_id resolution into a real write path rather than assuming the backfill covers it).
