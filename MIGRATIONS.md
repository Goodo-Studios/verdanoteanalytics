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
