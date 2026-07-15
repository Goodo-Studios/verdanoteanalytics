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
# Migration ordering — Entity Report (Feature 2)

These migrations use **placeholder timestamp prefixes** (`20260717000001`,
`20260717000002`, …). They are additive and idempotent, but they are NOT
guaranteed to sort after whatever else has landed on `main` by merge time.

**The orchestrator must, before applying to prod:**

1. **Renumber** the placeholder migrations so their timestamps sort strictly
   after the latest migration already on `main`, preserving relative order:
   - `20260717000001_entity_creative_embeddings.sql` — `creative_embeddings`
     table (512-dim pgvector, HNSW cosine) + RLS.
   - `20260717000002_entity_clusters.sql` — `creative_clusters` table,
     `cluster_id` / `cluster_confidence` columns on `creatives`,
     `match_creatives()` helper, and the IDOR-guarded read RPCs
     (`rpc_entity_report`, `rpc_entity_cluster_members`) with `authenticated`
     EXECUTE revoked.
2. **`supabase db push`** manually (no `db push` was run in this worktree).
3. **Deploy the new edge functions** (registered in `supabase/config.toml` and
   `scripts/deploy-functions.sh`):
   - `creative-embed` (service-role batch; reuses vault-embed OpenRouter path)
   - `cluster-creatives` (service-role batch; no cron wired in v1)
   - `entity-report` (session-authed read; verifies JWT + account ownership)
4. **Run the pipeline for the builder account** `act_782159176742035`:
   ```
   POST /functions/v1/creative-embed    { "account_id": "act_782159176742035" }
   POST /functions/v1/cluster-creatives { "account_id": "act_782159176742035" }
   ```
   `creative-embed` returns `coverage_pct` (share of creatives that had a text
   feature to embed) — record it; low coverage means weak clusters. Re-running
   `cluster-creatives` is idempotent (it resets prior assignments first).

Migrations are additive: they only `add column if not exists` / `create table if
not exists`, so re-application is safe.
# Migrations

Notes for applying `supabase/migrations/*.sql`. All migrations are written to be
**idempotent and additive** (re-applying is a no-op) so `supabase db push` is safe
to re-run.

## Version-number collisions and renumbering

`supabase db push` matches applied migrations **by version-number prefix**, not by
file content. If a new file reuses a version number that prod has already recorded,
push **silently skips it** (see the `verdanote-db-push-matches-by-version-number-collision-skips`
learning). So new migrations authored in a feature branch are numbered as
**placeholders** past the last-applied prod number, and the orchestrator **renumbers**
them to the next free slot at deploy time if a collision exists.

## Pending (feature branch: landing-pages)

### `20260718000001_rpc_landing_page_creatives.sql` — PLACEHOLDER, orchestrator renumbers

Landing Pages report US-004 (destination drill-in). Adds the
`get_landing_page_creatives(p_account_id text, p_from date, p_to date, p_destination_key text)`
RPC: returns the per-creative rows (ad_id, ad_name, thumbnail_url, preview_url,
video_url, spend, impressions, clicks, purchases, purchase_value, roas, cpa, ctr, cpc)
for every creative whose `creatives.destination_key = p_destination_key`, over an
account + window (<= 365 days). Base metrics are summed; ratios are derived from the
sums (never averaged), mirroring `get_creative_window_aggregates`. `CREATE OR REPLACE`
(idempotent). `SECURITY DEFINER`; **authenticated EXECUTE is revoked** and only
`service_role` is granted, so the session-authed `landing-pages` edge function (JWT +
account-ownership gate) is the sole caller — closes the same cross-account IDOR class
as `20260714000013`.

- **Numbered `20260718000001` as a placeholder.** It must land after the migrations
  already applied to prod today (`…000010`–`…000013`). If `20260718000001` (or any
  earlier `2026071800000x`) is already recorded in prod at deploy time, the
  orchestrator should renumber this file to the next free version slot before
  `supabase db push`, otherwise push will skip it.
- DB RPC only — no new edge-function directory is added, so `config.toml` /
  `deploy-functions.sh` are intentionally untouched by this migration. (The
  `landing-pages` edge function itself is redeployed to pick up the drill-in branch.)
