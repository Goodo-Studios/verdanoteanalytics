---
id: verdanote-cluster-ids-are-stale-check-last-seen-before-claiming-live-state
title: Verdanote cluster_id reflects the LAST cluster-creatives run, not current embeddings — check last_seen_at before describing live Entity Report state
scope: repo
trigger: reasoning about, reporting, or acting on what the Entity Report / cluster_id currently shows for a Verdanote account
when: verdanote && (cluster || clusters || cluster_id || entities || entity || "/entities" || embedding || recluster)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-02
updated: 2026-08-02
source: task-completion
---

## Rule

ALWAYS check `creative_clusters.last_seen_at` against `creative_embeddings.updated_at`
before stating what `/entities` currently shows. `cluster-creatives` is NOT on a cron,
so `cluster_id` reflects whenever it was last invoked — not the current embeddings.
Stored clusters routinely lag the data they were derived from.

NEVER infer live production clustering from a simulation of the clustering maths over
current embeddings. That describes what the NEXT run will produce, which can be a
completely different state. Simulated, live, and historical are three distinct answers
and they have been three distinct answers in practice.

ALWAYS land a clustering-behaviour change BEFORE re-clustering any account. Because
`cluster-creatives` resets every `cluster_id` for the account and re-stamps from
scratch, a re-cluster instantly propagates whatever the current grouping rule is to
every account it touches. Re-clustering first and fixing second means shipping the
bad state to all 15 accounts in between.

Note when reading the function: grouping unions on THREE modalities (note, visual,
script embeddings) plus anchors, and it is genuinely O(n²) all-pairs in one edge
invocation — no ANN, no candidate scoping. Any single-modality model of it
under-estimates how much it merges.

## Rationale

Measured on Bearaby `act_2223094124606317` (2,391 ACTIVE ads) on 2026-08-02, three
different answers to "what is the clustering?" were all simultaneously true:

| | clusters | largest | singletons |
|---|---|---|---|
| live `cluster_id` today | 701 | 261 (17.3%) | 46.4% |
| simulation over current embeddings | 9 | 2,126 (97%) | 66.7% |
| historical v1 behaviour | — | — | 88% |

Live clusters came from a **2026-07-24** run; embeddings had moved on **2026-07-28**,
and 37.1% of active ads carried no `cluster_id` at all. A spike asserted the 97%
mega-blob as the current production state and it was reported upward that way. It was
wrong — the blob was latent, not live.

The distinction mattered operationally: it changed the finding from "live incident
across 15 accounts" to "loaded footgun that fires on the next re-cluster", which
converts the fix from remediation into a **sequencing constraint**. Same code change,
completely different urgency and rollout order.
