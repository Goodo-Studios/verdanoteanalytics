---
id: verdanote-table-audit-hidden-sm-grid-anti-pattern
title: Grep for `hidden sm:grid` + fixed grid-cols when auditing Verdanote tables for mobile/tablet friendliness
scope: repo
trigger: auditing the verdanoteanalytics repo for mobile/tablet layout issues, or building/reviewing a new data table component
when: verdanote && (mobile || tablet || responsive || table || grid)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
version: 1
created: 2026-08-08
updated: 2026-08-08
source: session-learning
public: false
---

## Rule

When auditing Verdanote (verdanoteanalytics repo) for mobile/tablet friendliness, grep for the `hidden sm:grid` + `grid-cols-[fixed_widths]` pattern first (e.g. `components/analytics/LeaderboardTab.tsx` before the fix). It silently drops or truncates the flexible label column below ~1024px because the fixed numeric columns (spend/ads/roas/ctr) reserve more width than the sidebar-narrowed content area leaves.

Most tables in this app correctly use `overflow-x-auto` or a `grid-cols-1 lg:grid-cols-[...]` stacked-to-side layout instead — that's the safe pattern to match new tables to.

## Rationale

Captured from a Verdanote mobile leaderboard fix session. The `hidden sm:grid` + fixed-width `grid-cols` combo fails silently (no error, no console warning) — it just truncates or drops the label column below ~1024px — so it's easy to miss in a casual review and needs to be actively grepped for during any mobile/tablet audit pass.
