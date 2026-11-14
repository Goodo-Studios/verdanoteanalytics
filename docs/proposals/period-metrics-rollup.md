# Proposal: daily rollup table for get_period_metrics

Status: proposal only. Nothing in this document is built. It needs an owner decision.

## Why this may be needed

The all-accounts form of `get_period_metrics` reads every row of `creative_daily_metrics` in the
date range (about 200k rows for 90 days). On production that cost 5.4 s cold, of which most is
reading about 32k table pages, and the rest a 10 MB on-disk sort.

The change in PR "period metrics load" removes the sort (per-ad hash aggregate), stops the
overview page from firing the current and previous period calls together, caches the all-accounts
answer for 10 minutes, and caps its retries at one. On staging data of production shape (400k
rows) the sort disappears and the query goes from 197 ms to 157 ms. The page read cost is
unchanged, so on a cold production cache the call is still expected to be several seconds.
Whether that clears the gateway limit has to be measured after the release.

## Design

Table `creative_daily_rollup(account_id text, date date, spend numeric, impressions bigint,
clicks bigint, purchases bigint, purchase_value numeric, adds_to_cart bigint, video_views bigint,
active_ads int, primary key (account_id, date))`. At most accounts x days rows (about 15 x 400).

- Fill and refresh: a trigger-free job. The sync functions already write `creative_daily_metrics`
  per account and day; after each account sync, run
  `INSERT ... SELECT account_id, date, sum(...), count(distinct ad_id) filter (where spend > 0)
  ... ON CONFLICT (account_id, date) DO UPDATE` for the days that sync touched.
- Read: `get_period_metrics` sums `creative_daily_rollup` for sums. Cost is a few thousand rows.
- active_count caveat: distinct ads across a multi-day range cannot be summed from per-day
  distinct counts. Options: keep `active_ads` approximate as the max per day (changes the number),
  store a per-day array or hyperloglog of ad ids (extra storage), or keep the exact count on a
  separate query limited to the picked account. The owner decides which is acceptable. The
  overview card "Active ads" currently shows the exact distinct count.
- Security: same caller gate as today. RLS on the rollup is deny-all, reads only through the
  SECURITY DEFINER function.
- Backfill: one statement over existing data, run in the migration (about 200k to 2M rows
  scanned once).
- Tests: pgTAP comparing rollup results to the raw query on seeded rows, plus a test for the
  sync-refresh path.

## Decision needed

1. Build the rollup after the next release shows the 502s persist (recommended: decide with
   measurements from production, not before).
2. Build it now.
3. Do not build it; accept a slow first all-accounts load, cached for 10 minutes.

If 1 or 2: pick the active_count approach (exact only per account, approximate across accounts,
or extra storage).
