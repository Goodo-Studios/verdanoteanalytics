---
id: verdanote-creative-fatigue-summary-unlabelled-metric
title: creative_fatigue_summary is an unlabelled metric series, not a fatigue score
scope: repo
trigger: Reading, surfacing, or building on Meta's creative_fatigue_summary field for Verdanote
when: creative_fatigue || fatigue || performance_summary || meta
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-01
updated: 2026-08-01
source: session-learning
applies_to: [meta]
---

## Rule

ALWAYS remember Meta's creative_fatigue_summary is NOT a fatigue score. It returns a list of {ad_object_id, performance_summary:{latest_ds, metric_value, historical_metric_values[~28 daily points]}} where metric_value is UNLABELLED — Meta never says which metric it is, so never present it as CTR or any named metric. It is also a partial ad selection (Flatpack returned 48 ads, Natural Dog 2), not the whole account.

## Rationale

Captured from a live API probe session (2026-08-01). The field name implies a scored fatigue verdict, but the payload is a raw ~28-point daily series per ad with no metric label and no scale. Labelling it as CTR (or anything else) in a UI or brief invents a fact Meta did not supply. Equally, because Meta returns only a subset of ads per account, any rollup built from it is not account-complete and must not be presented as coverage.
