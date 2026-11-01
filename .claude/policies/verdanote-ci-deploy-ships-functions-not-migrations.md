---
id: verdanote-ci-deploy-ships-functions-not-migrations
title: verdanoteanalytics CI deploy ships edge functions only — apply DB migrations manually with db push from the main repo
scope: repo
trigger: merging a verdanoteanalytics PR that adds a `supabase/migrations/` file, or expecting a migration to reach prod via the push-to-main GitHub Actions deploy
enforcement: soft
public: false
version: 4
created: 2026-05-30
updated: 2026-08-01
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: For verdanoteanalytics, the GitHub Actions deploy job ("Deploy Supabase edge functions") ships ONLY edge functions on push to main — it does NOT apply DB migrations. After merging a PR that adds a migration, separately run `supabase db push --linked` from the linked MAIN repo (`repos/private/verdanoteanalytics`) to apply it to prod; git worktrees are not Supabase-linked (no `supabase/.temp` project-ref), so `db push` must run from the main checkout.

ALWAYS: For verdanoteanalytics, the CI "Deploy Supabase edge functions" job is skipped on pull requests and only runs on push to main — merging a PR is what redeploys edge functions to prod. Don't expect edge-fn deploy from PR CI.

ALWAYS: When deploying verdanote schema + function changes together, apply migrations FIRST (`supabase db push`) and THEN deploy the functions. Because merging to main auto-deploys edge functions (before any migration has run), a merge-first order ships new functions that call RPCs/tables/columns which do not yet exist — breaking prod during the gap. When a function depends on new schema, push the migration manually BEFORE the merge that redeploys functions, not after.

ALWAYS (verdanoteanalytics): CI does NOT auto-apply Supabase migrations (the deploy workflow only WARNS on migration changes) and the 'Deploy Supabase edge functions' job is gated behind the 'Lint, typecheck & test' job passing (needs: check). So a red test suite on main silently skips edge-function deploys, and migrations always require a manual `supabase db push`. Merging to main != deployed.

## Rationale

Captured during a verdanoteanalytics PR-6 deploy. The CI deploy job only runs `scripts/deploy-functions.sh` (edge functions) on push to main, so a migration merged in the same PR lands in `supabase/migrations/` but never executes against prod. The migration must be applied out-of-band with `supabase db push --linked`. That command requires a Supabase-linked checkout: only the main repo at `repos/private/verdanoteanalytics` carries the `supabase/.temp` project-ref, so running `db push` from a git worktree fails with no linked project — it must run from the main checkout.

The deploy job is gated on push-to-main, not PR events, so opening or updating a PR will not trigger an edge-function deploy. The act of merging (which pushes to main) is what actually redeploys edge functions to prod — don't wait for or expect a deploy from PR CI runs.
