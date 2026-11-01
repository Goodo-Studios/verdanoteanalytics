---
id: verdanote-coverage-rollup-strict-definition
title: Restate every account on one strict coverage definition when rolling up
scope: repo
trigger: Rolling up tag/data coverage across multiple Verdanote accounts into project totals.
enforcement: soft
public: false
version: 1
created: 2026-05-30
updated: 2026-05-30
source: session-learning
---

## Rule

ALWAYS: When rolling up coverage across accounts, restate every account on a single strict definition (authoritative = parsed+csv_match+manual; inferred is NOT covered). Per-story commit messages sometimes fold inferred into a looser coverage %, so normalize in the rollup to keep project totals consistent.

## Rationale

Captured during the Verdanote tag-coverage account sweep. Individual story commits occasionally counted inferred matches inside a looser coverage percentage, which would inflate and desync project totals. Normalizing every account to the strict authoritative definition (parsed + csv_match + manual only) keeps the rollup internally consistent.
