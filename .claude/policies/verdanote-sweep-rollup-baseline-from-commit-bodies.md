---
id: verdanote-sweep-rollup-baseline-from-commit-bodies
title: Source multi-story sweep rollup baselines from git commit bodies, not prd.json
scope: repo
trigger: Building a multi-story sweep rollup (Verdanote tag-coverage style) that needs per-story before/after baselines.
enforcement: soft
public: false
version: 1
created: 2026-05-30
updated: 2026-05-30
source: session-learning
---

## Rule

ALWAYS: For multi-story sweep rollups (Verdanote tag-coverage style), source per-story before/after baselines from the worktree git commit bodies — each story commit message carries its exact delta. prd.json completionNotes are not a reliable per-story baseline store; the commit log is authoritative.

## Rationale

Captured during the Verdanote tag-coverage account sweep. Per-story commit messages record the exact before/after delta for each account at the moment the story landed, whereas prd.json completionNotes drift, get summarized, or omit the precise numbers — making the commit log the authoritative baseline source for rollups.
