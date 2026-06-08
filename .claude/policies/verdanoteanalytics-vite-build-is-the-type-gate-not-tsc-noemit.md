---
id: verdanoteanalytics-vite-build-is-the-type-gate-not-tsc-noemit
title: Treat `vite build` (esbuild) as the type gate in verdanoteanalytics, not `tsc --noEmit`
scope: repo
trigger: type-checking verdanoteanalytics, or about to claim you introduced a type error
enforcement: soft
public: false
version: 1
created: 2026-06-03
updated: 2026-06-03
source: session-learning
---

## Rule

ALWAYS: in verdanoteanalytics, treat `vite build` (esbuild) as the type gate, NOT `tsc --noEmit` — main carries ~34 pre-existing tsc errors (generated types.ts lacks hand-typed vault tables, plus deep-instantiation noise). CI 'Lint, typecheck & test' passes despite them. Before claiming you introduced a type error, diff the error COUNT against a clean stash of main; vault rows cast `as unknown as T` because their columns aren't in the generated types.

## Rationale

`tsc --noEmit` reports ~34 errors on a clean checkout of main: the generated `types.ts` does not include the hand-typed vault tables, and there is additional deep-instantiation noise. The CI 'Lint, typecheck & test' job is green despite these, so the authoritative type gate is `vite build` (esbuild). Treating raw `tsc --noEmit` output as a regression signal produces false positives. To know whether you actually introduced a type error, diff the error count against a clean stash of main rather than reading the absolute count. Vault rows are intentionally cast `as unknown as T` because their columns aren't present in the generated types.
