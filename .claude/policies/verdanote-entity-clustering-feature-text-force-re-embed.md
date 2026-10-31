---
id: verdanote-entity-clustering-feature-text-force-re-embed
title: Entity clustering feature text — enrich buildFeatureText, then force re-embed + re-cluster
scope: repo
trigger: Changing what fields feed Verdanote entity clustering (buildFeatureText), or debugging high-singleton / low-coverage clustering
when: clustering || cluster-creatives || buildFeatureText || embed
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

Verdanote entity clustering embeds a 'feature text' (buildFeatureText in supabase/functions/_shared/entity-clustering.ts). v1 used only ai_visual_notes + the 6 tags, starving clustering (88% singletons, ~4% coverage). Feeding the rich analyze-creative fields (brand_name, target_audience, value_structure, hook_visual, hook_type, ad_format, industry) requires a FORCE re-embed + re-cluster to take effect — embeddings are only rebuilt on force, and cluster-creatives is not on a cron.

## Rationale

Captured as a session learning. The clustering quality is bounded by what `buildFeatureText` embeds; the v1 text (only `ai_visual_notes` + 6 tags) produced 88% singletons and ~4% coverage. Enriching it with the analyze-creative fields (`brand_name`, `target_audience`, `value_structure`, `hook_visual`, `hook_type`, `ad_format`, `industry`) only changes results after a FORCE re-embed, because embeddings are rebuilt only on force, followed by a manual re-cluster since `cluster-creatives` is not scheduled on a cron.
