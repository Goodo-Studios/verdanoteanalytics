---
id: verdanote-supabase-ledger-drift-reconcile-with-db-push
title: Reconcile Supabase migration ledger drift with db push, never repair --reverted
scope: repo
trigger: supabase migration list / db push shows "Remote migration versions not found in local migrations directory", or DDL/data was applied to prod outside the migration ledger (service-role PostgREST, SQL editor, manual psql)
enforcement: hard
public: false
version: 3
created: 2026-05-30
updated: 2026-08-01
source: success-pattern
applies_to: [supabase]
---

## Rule

When the Supabase migration ledger is out of sync with the local `supabase/migrations/` directory, reconcile by **registering** the real migrations, not by reverting them.

1. **First, sync the local working tree.** A ledger-drift error frequently means the local checkout is simply behind `main`. Run `git merge --ff-only origin/main` (or otherwise bring the migrations directory current) and re-run `supabase migration list --linked` / `supabase db push --dry-run` before doing anything else. Most "remote-only" entries resolve here once the migration files are actually present locally.

2. **If a migration was applied to prod outside the ledger** (e.g. override/backfill artifacts pushed via service-role PostgREST during a sweep, or DDL run in the SQL editor), the DATA is already live but the ledger row is missing. Reconcile by running `supabase db push --linked --yes` with the corresponding idempotent migration files present locally. Because the migrations are idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, no-demote `DO` blocks), re-applying them is a no-op against existing objects — they come back `already exists, skipping` and the push simply registers the ledger rows. Verify zero pending afterward.

3. **NEVER run `supabase migration repair --status reverted <version>` on a migration that genuinely ran.** The CLI suggests this when it sees a remote ledger row with no local file, but marking a legitimately-applied migration as `reverted` corrupts the ledger: a later `db push` will try to re-run it as if it never executed, and any non-idempotent statement in it will fail or duplicate state. `repair --reverted` is only correct for a migration that truly never applied to the database — confirm that against the actual schema before ever using it.

4. **Remote-ahead drift — reconcile by supplying the missing file, never by reverting.** When `supabase db push` fails with "Remote migration versions not found in local migrations directory" (or the CLI suggests `migration repair --status reverted <id>`), it means prod holds a migration version whose file is absent from the pushing checkout. Reconcile by copying/committing the already-applied migration file(s) into the checkout and onto `main`, so the local set is a clean superset of remote. This does NOT re-run them — Supabase skips versions already in `schema_migrations` — it only satisfies the local↔remote integrity check so genuinely-pending migrations can push. Then `--dry-run` to confirm ONLY the new migration is pending before pushing. Verify ground truth with `supabase migration list --linked` (LOCAL | REMOTE columns). Do NOT use `migration repair --status reverted` for a migration that is actually live.

## Rationale

During the tag-coverage-account-sweep ship, the 7 override migrations had already been applied to prod via service-role PostgREST while the sweep ran, so prod held the data but the migration ledger had no rows for them. A first `db push --dry-run` also flagged two Phase-C migrations (`20260530000003`, `20260530000004`) as "remote migration versions not found locally" purely because the local `main` working tree was transiently behind — the files existed in history but not in the checkout. The CLI helpfully suggested `migration repair --status reverted` for those two, which would have been destructive: both were real, applied migrations, and reverting them in the ledger would have caused a future `db push` to re-run them.

The safe resolution was: fast-forward the local tree to `origin/main` (which made the two Phase-C entries show as synced), then `supabase db push --linked --yes` to register all pending idempotent migrations — `customer_reviews`/`angle_clusters` came back `already exists, skipping`, confirming pure ledger registration with zero schema change. The ledger ended fully reconciled with zero pending and no data touched.
