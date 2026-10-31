---
id: verdanote-deno-edge-tests-are-manual-not-in-ci-vitest
title: Verdanote — Supabase edge-function deno tests are MANUAL; CI vitest never runs them
scope: repo
trigger: relying on a Supabase edge-function deno test (supabase/functions/**/index.test.ts) as a regression gate, or assuming a green CI check ran it
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: treat Verdanote Supabase edge-function deno tests (supabase/functions/**/index.test.ts) as MANUAL — CI `npm run test` is vitest scoped to `src/**` only and never runs them. Run `deno test -A supabase/functions/<fn>/index.test.ts` locally before relying on a function-level regression test; a green CI 'check' job does NOT mean the deno tests ran.

## Rationale

Captured during a Verdanote edge-function session. The repo's CI `check` job runs `npm run test` (vitest), which is scoped to `src/**` and is structurally blind to `supabase/functions/**/index.test.ts` (those are Deno, not vitest). A green CI check therefore says nothing about whether the edge-function regression tests pass. The only way to exercise them is `deno test -A supabase/functions/<fn>/index.test.ts` locally; skipping this lets a broken edge function ship behind a green check.
