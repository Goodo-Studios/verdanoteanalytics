---
id: verdanote-e2e-suite-is-flaky-rerun-before-blocking
title: Verdanote — treat the verdanoteanalytics E2E suite as flaky; re-run before treating a red as your regression
scope: repo
trigger: a verdanoteanalytics Playwright E2E job goes red on main or on a PR, especially client-home winners-section or the client auth.setup login
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-07-17
version: 2
---

## Rule

ALWAYS: Treat the `verdanoteanalytics` E2E suite as flaky. Specifically, the `client-home.spec.ts` winners-section assertion (`winnerCard.or(emptyState)`) and the client `auth.setup` login intermittently fail or time out, and main is frequently red on them. Re-run the E2E job to confirm a flake before treating it as a blocker. NEVER assume an E2E red is your regression without first checking that the failing test is inside the scope you actually changed.

ALSO expect `e2e/vault.spec.ts:311` ('Vault — save analytics creative to global library US-006') to flake with a 360000ms timeout — it repeatedly blocked otherwise-green PRs (edge-fn/SQL-only changes it cannot affect). Re-run the failed E2E job to clear it; it passes on re-run. Stabilizing it is a tracked follow-up.

Note this does NOT relax `e2e-testing-standards` — never `test.skip`, loosen assertions, or paper over a genuine failure. The discipline here is diagnostic: distinguish a known flake (re-run passes, failing test is outside your changed scope) from a real regression before acting, and fix the root cause when it is real.

## Rationale

Captured during a Verdanote session where main was red on the client-home winners-section and client-login E2E checks that had nothing to do with the change in flight. Re-running the job cleared them, confirming flakiness rather than a regression. Conflating a known-flaky red with a true blocker wastes a debugging cycle and can stall an otherwise-shippable change; checking whether the failing test is in your changed scope is the fast disambiguator.
