---
id: verdanote-winners-decided-by-spend-first
title: Winners are decided by spend first, not ROAS
scope: repo
trigger: implementing or changing any winner-selection or Winner/Rising/Fatiguing classification logic
when: winner || classif || classify || (spend && roas)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: hard
public: false
version: 1
created: 2026-07-15
updated: 2026-07-15
source: user-correction
---

## Rule

Decide "winners" by SPEND FIRST, not ROAS, everywhere in the product. A top-spend,
non-fatiguing creative is a Winner regardless of ROAS/efficiency — Meta backs its
winners with budget, so relative spend is the primary signal. Any winner-selection
or Winner/Rising/Fatiguing classification must gate on relative spend (e.g. a spend
percentile), never on a ROAS threshold. ROAS/thumbstop may be shown as context, but
must not be the gate that makes something a winner. Fatigue still takes precedence
(a deteriorating high-spend ad is a risk, not a winner). Applies to the Creative
Library classifier (`supabase/functions/_shared/creative-classification.ts`) and any
future Winners surface.

## Rationale

Owner directive (2026-07-15): the Creative Library classifier originally gated
"Winner" on `highSpend && (ROAS>=2 || thumbstop>=30)`, so genuinely high-spend ads
with mediocre ROAS were mislabeled. Corrected to spend-first (`highSpend &&
!fatiguing`). NOTE: the pre-existing `src/lib/winnerSelection.ts` (Overview win-rate)
is still ROAS/KPI-configurable per account and was NOT changed — confirm with the
owner whether that surface should also become spend-first before touching it.
