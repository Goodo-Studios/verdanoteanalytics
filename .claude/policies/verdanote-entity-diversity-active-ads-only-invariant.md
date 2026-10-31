---
id: verdanote-entity-diversity-active-ads-only-invariant
title: Entity clustering / diversity is scoped to ACTIVE ads only — only active ads carry a cluster_id
scope: repo
trigger: Running cluster-creatives, reading rpc_entity_report, or reasoning about Verdanote entity-diversity numbers
when: cluster-creatives || cluster_id || rpc_entity_report || entity
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

- Verdanote entity clustering is a LIVE diversity signal scoped to ACTIVE ads only (ad_status='ACTIVE') — the question it answers is 'is the content currently running too similar or too diverse?', goal = diverse. cluster-creatives filters candidates to active; paused/old ads get cluster_id=null. Do NOT cluster the whole library. Invariant: only active ads carry a cluster_id.
- Verdanote rpc_entity_report does NOT itself filter ad_status — it relies on the invariant that only active ads have cluster_id (enforced by active-only cluster-creatives). If clustering is ever re-run over all ads, the Entity Report diversity numbers will be polluted by paused ads. For robustness a future change could add an explicit ad_status='ACTIVE' filter to rpc_entity_report.

## Rationale

Captured as a session learning from the entity-clustering / diversity work. The diversity signal is about currently-running creative, so clustering is deliberately scoped to active ads and the "only active ads carry a cluster_id" invariant is what keeps the Entity Report clean. Because rpc_entity_report has no ad_status filter of its own, that invariant is load-bearing: re-clustering over all ads (active + paused) would silently pollute the diversity numbers with dead creative.
