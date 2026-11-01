---
id: verdanote-entity-clustering-is-text-only-not-visual
title: Verdanote entity clustering is TEXT-only — never describe it as visual similarity
scope: repo
trigger: Describing, documenting, or reasoning about how Verdanote entity clustering groups creatives (visualCoherent / scriptCoherent, cluster coverage)
when: clustering || cluster-creatives || buildFeatureText || embed || visualCoherent || modalityCoherent
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-01
updated: 2026-08-01
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS treat Verdanote entity clustering as TEXT-only, never visual. _shared/entity-clustering.ts embeds buildFeatureText (ai_visual_notes + rich analysis fields + tags) via openai/text-embedding-3-small @512d. The modalityCoherent()/blendedTier() 'visualCoherent' vs 'scriptCoherent' split is TWO TEXT EMBEDDINGS (visual notes vs transcript) — nothing in the pipeline has ever looked at a pixel. That is why it clusters by concept rather than by look and why coverage tracks ai_visual_notes availability (0-40%/account). Do not describe it as visual similarity.

## Rationale

Captured 2026-08-01. The `visualCoherent` naming reads as image comparison and has been repeatedly misread that way in briefs and UI copy. In reality both sides of the modality split are text embeddings — one over LLM-written visual notes, one over the transcript — so the clusters express conceptual overlap, and coverage is bounded by how many creatives have `ai_visual_notes` at all (0-40% depending on account). Calling it visual similarity overstates the signal and misdirects any effort to improve it. Related: `verdanote-entity-clustering-feature-text-force-re-embed` (how to change what is embedded).
