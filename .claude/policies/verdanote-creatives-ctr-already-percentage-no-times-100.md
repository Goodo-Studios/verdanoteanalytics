---
id: verdanote-creatives-ctr-already-percentage-no-times-100
title: creatives.ctr is already a percentage (Meta convention) — render with no ×100
scope: repo
trigger: Rendering or formatting the creatives.ctr field (or any Meta Insights ctr value) in a UI component, formatter, or report.
enforcement: soft
public: false
version: 1
created: 2026-05-30
updated: 2026-05-30
source: session-learning
---

## Rule

Verdanote stores `creatives.ctr` as a percentage already (Meta Insights `ctr` field, e.g. `1.67` = 1.67%), not a fraction. Render it as `ctr.toFixed(2) + '%'` with NO ×100. Every other component does this correctly; only `LeaderboardTab.fmtCtr` got it wrong and showed `167%`.

## Rationale

The Meta Insights API returns `ctr` already expressed as a percentage value (e.g. `1.67` means 1.67%), and Verdanote persists it that way in `creatives.ctr`. Multiplying by 100 at the render layer double-scales it and produces nonsense like `167%`. The bug was isolated to `LeaderboardTab.fmtCtr`; all other surfaces format it directly with `.toFixed(2) + '%'`. (Related but distinct from `verdanote-pct-fields-true-percentage-at-source`, which governs `*_pct`-named fields at the RPC source layer; `ctr` is not a `_pct` field and the issue here was render-side double-scaling.)
