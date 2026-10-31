---
id: verdanote-pct-fields-true-percentage-at-source
title: Define *_pct fields as true percentages [0,100] at the source-of-truth layer
scope: repo
trigger: Authoring or modifying any SQL/RPC, edge function, or API field whose name ends in _pct (or otherwise denotes a percentage) that downstream surfaces render.
enforcement: soft
public: false
version: 1
created: 2026-05-29
updated: 2026-05-29
source: task-completion
---

## Rule

Any field whose name denotes a percentage — `*_pct`, `*_percent`, `coverage_pct`, etc. — must carry a true percentage value in the range `[0, 100]` at the single source-of-truth layer (the Postgres RPC or whatever the canonical computation is). Do not emit a `0..1` ratio under a percent-named field and expect consumers to multiply.

The field name is the contract. Every downstream consumer (edge function, MCP tool, React component) treats a `*_pct` value as already-a-percentage and renders it directly. If the source returns a ratio (e.g. `0.573`), the UI renders `Math.round(0.573)` = `1%` while the true value is `57%`, and the bug is invisible to per-surface unit checks because they all compare against the same wrong ratio.

Compute the percentage once, at the source: `round((numerator / denominator) * 100, 2)`. Fix the encoding at the RPC layer, never per-surface — one `CREATE OR REPLACE` corrects every consumer simultaneously and prevents three-way drift.

## Rationale

On the verdanote hook-angle-library project, `rpc_hook_angle_coverage` returned `tag_coverage_pct` as a `0..1` ratio (`0.573`). All three surfaces — the `/api/library` edge function, the `verdanote_library` MCP tool, and the React `/ad-library/hooks` page — consumed the field as a percentage. The React surface rendered `0.573` as `1%` when true hook-tag coverage was `57.3%`. Per-surface unit checks all passed because each compared against the same wrong ratio; only the cross-surface E2E loop (US-005) exposed it. The fix was a single `CREATE OR REPLACE` at the RPC layer (migration `20260530100000_fix_coverage_pct_percentage.sql`: `round((t.tagged_spend / t.total_spend) * 100, 2)`), which corrected all three surfaces at once. Defining the percentage correctly at the source the first time would have avoided the bug entirely.
