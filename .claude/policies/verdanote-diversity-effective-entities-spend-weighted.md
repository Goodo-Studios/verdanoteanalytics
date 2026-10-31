---
id: verdanote-diversity-effective-entities-spend-weighted
title: Diversity metric is effective_entities (spend-weighted), not the raw distinct-entity count
trigger: Reporting or interpreting Verdanote entity-diversity numbers
when: effective_entities || diversity || entity
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

Verdanote diversity: the meaningful metric is effective_entities (SPEND-WEIGHTED distinct concepts), NOT the raw distinct-entity count. An account can have 900 distinct active entities but effective_entities ~3 (spend piled on a few) — that's a budget-allocation problem, distinct from 'not enough varied creative'. Report both.

## Rationale

Captured as a session learning. Raw distinct-entity counts overstate diversity because they ignore how spend is distributed: 900 distinct active entities with effective_entities ~3 means almost all budget sits on a few concepts (a budget-allocation problem), which is a different diagnosis than genuinely narrow creative. Reporting both the raw count and effective_entities keeps those two failure modes separable.
