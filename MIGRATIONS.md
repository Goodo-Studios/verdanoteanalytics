# Creative Rotation + F2 lifecycle dates — migration & deploy notes

Branch: `feature/creative-rotation`. Nothing here was pushed or `db push`ed.

> **Orchestrator: the two migrations use placeholder date prefix `20260715000001`
> / `20260715000002` to avoid collisions with parallel agents/prod. Renumber them
> to the real next slot before `supabase db push`.** They are additive and
> idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`), so re-applying is
> safe, but they MUST land in numeric order (000001 before 000002).

## Migrations (apply in order)

1. **`20260715000001_creative_lifecycle_dates.sql`** — F2 shared foundation.
   - Adds nullable columns to `public.creatives`: `launch_date`,
     `first_added_date`, `first_spend_date` (+ index
     `idx_creatives_account_launch_date`).
   - Adds RPC `derive_creative_lifecycle_dates(p_account_id text)` that recomputes
     all three from `creatives.created_time` (already synced) + `creative_daily_metrics`.
   - `launch_date` = date of `created_time`; `first_spend_date` = earliest daily
     row with spend>0; `first_added_date` = earliest of first daily date / our
     `created_at`. Account tenure is computed on query (not stored).
   - IDOR: `derive_creative_lifecycle_dates` trusts `p_account_id` → EXECUTE
     revoked from `authenticated`, granted to `service_role` only.
   - **SHARED with Sian's `feature/fatigue-curve` branch.** Both consume the same
     `launch_date` / `first_spend_date` columns + backfill. If Sian's branch lands
     first with an equivalent F2 migration, KEEP ONE copy of the column-adds and
     the derive RPC (they are `IF NOT EXISTS` / `CREATE OR REPLACE`, so a duplicate
     is harmless but should be de-duped when reconciling). Do not ship two
     divergent definitions of these columns.

2. **`20260715000002_rpc_creative_rotation.sql`** — Feature 3 report RPCs (depends
   on the F2 columns above). Three SECURITY DEFINER RPCs, all trusting
   `p_account_id` → EXECUTE revoked from `authenticated`, granted to `service_role`:
   - `rpc_creative_rotation_freshness(account, from, to, fresh_days)` — weekly
     spend-by-age (fresh/mid/stale) + a synthetic `total` row carrying the window
     freshness KPIs (fresh %spend, spend-weighted age, fresh vs stale CPA).
   - `rpc_creative_rotation_cohorts(account, from, to)` — launch-cohort table.
   - `rpc_creative_rotation_new_ads_timeline(account, from, to)` — new-ads-by-week
     timeline + running cumulative.
   - Ratios are DERIVED from summed base metrics (never averaged); percentages are
     true percentages (share*100), mirroring `20260714000004`.

## Edge functions to deploy

- **`backfill-launch-dates`** (`verify_jwt=false`, internal/service-role caller) —
  batch Meta Graph `?ids=...&fields=created_time` to fill `creatives.created_time`
  for older ads, then calls `derive_creative_lifecycle_dates`. Token precedence:
  env `META_ACCESS_TOKEN`, then `settings.meta_access_token`. Registered in
  `config.toml` + `scripts/deploy-functions.sh`.
- **`creative-rotation`** (`verify_jwt=false`, session-authed internally) — read
  fn for the report. Mirrors `leaderboard` (auth.getUser + verifyAccountOwnership),
  invokes the three IDOR-gated RPCs via service role. Registered in `config.toml`
  + `scripts/deploy-functions.sh`.
- Both import `_shared/lifecycle-dates.ts` (new). Per the deploy script header,
  redeploy any function that imports `_shared/` after this lands — but only these
  two import the new file.

## Backfill to run (builder account first)

After the migrations + fn deploy, populate lifecycle dates for the builder
account `act_782159176742035` (Goodo):

```
POST /functions/v1/backfill-launch-dates   { "account_id": "act_782159176742035" }
```

`created_time` is already synced for most ads, so this mostly just runs the
derive step; older ads missing `created_time` get a Meta batch lookup. Idempotent
— safe to re-run.

## Shared foundations touched (reconcile with parallel branches)

- `supabase/migrations/20260715000001_creative_lifecycle_dates.sql` (F2) — shared
  with `feature/fatigue-curve`.
- `supabase/functions/_shared/lifecycle-dates.ts` — new shared util (F2 helpers).
- `supabase/config.toml`, `scripts/deploy-functions.sh` — appended two entries
  each (no existing entries changed).
- `src/lib/api.ts`, `src/lib/routePrefetch.ts`, `src/App.tsx`,
  `src/components/AppSidebar.tsx` — additive (new page wiring only).

## Local verification (this branch)

- `deno test supabase/functions/_shared/lifecycle-dates.test.ts` → 5 passed.
- `npm run build` (vite = the type gate) → passed, `CreativeRotationPage` chunk emitted.
- `npx vitest run src/test/CreativeRotationPage.test.tsx` → 4 passed.
