# Proposal: production query timeouts

Status: proposal only. Nothing here has been applied to production. The SQL below is deliberately not in `supabase/migrations`, so merging this file changes nothing. Applying it to production needs the owner's go.

## What was seen

Read-only checks on production after the 2026-11-14 release found 59 statement timeouts (error 57014) between 14:39 and 17:08 UTC, still occurring at the end of the window. The roles that hit them have short limits: `authenticated` 8 s, `anon` 3 s, `authenticator` 8 s. `service_role` has none.

| Caller | Failures | Query |
| --- | --- | --- |
| `analyze-creative` cron (every 2 min) | 23 x 500 | RPC `next_creative_analysis_account()` |
| App, `useWoWTrends` with "all accounts" | 17 x 500 | `creative_daily_metrics` where `date >= <14 days ago>` order by `date`, paged 1000 rows at a time |
| App | 7 x 500, 5 x 502 | RPC `get_period_metrics` (not diagnosed, see below) |
| `creatives` function | 5 | "Creatives error: canceling statement due to statement timeout" |

## Finding 1: creative_daily_metrics has no index on date alone

The table has 721k rows (512 MB with indexes). Its indexes are `(ad_id, date)` twice (the primary key and `idx_daily_metrics_ad_date`, which are identical) and `(account_id, date)`. The query without an account filter has to read the whole `(account_id, date)` index and then fetch the heap rows in random order.

Production `EXPLAIN (ANALYZE, BUFFERS)` of the app query (page 1, read-only): Bitmap Index Scan on `idx_daily_metrics_account_date`, 24,107 heap blocks, 28,249 buffers read, 4,504 written, top-N sort, **9.7 s** against an 8 s limit. About 38,000 rows match.

### Proposed change

```sql
-- one statement, run on its own (CONCURRENTLY cannot run inside a transaction block)
create index concurrently if not exists idx_daily_metrics_date
  on public.creative_daily_metrics (date);
```

Size: roughly 20 MB. Writes to the table get slightly slower.

### Staging test

Staging holds only 960 rows in this table, so a real timing is not possible there. The test used a scratch temp table on staging with the same shape (760,000 rows, primary key on `(ad_id, date)`, an `(account_id, date)` index, dates spread over 401 days), inside a block that raised an error at the end so nothing stayed behind.

| | Plan | Buffers | Time (warm) |
| --- | --- | --- | --- |
| Before | Bitmap scan on the account index, top-N sort of 28,425 rows | 2,835 | 23.5 ms |
| After `(date)` index | Index scan in date order, stops after 1000 rows | 1,004 | 4.5 ms |

The same plan shape as production, with about 3 times fewer buffers in the test. On production the first page should drop from about 28,000 buffer reads to about 1,000. This is a plan and buffer comparison, not a production timing.

### Alternatives

- Covering index, `(date) include (ad_id, spend, purchase_value)`: lets the query run as an index-only scan with contiguous reads, at about 2 to 3 times the size. Not tested here.
- App side: `useWoWTrends` orders by `date` only, so rows with the same date can move between pages. Ordering by `date, ad_id` makes the paging stable and matches a `(date, ad_id)` index. It also pages through all rows on the client for "all accounts"; a grouped RPC would remove most of the reads. Both are code changes through a normal PR.
- Housekeeping: `idx_daily_metrics_ad_date` duplicates the primary key and can be dropped later (`drop index concurrently`), which saves disk and write time. Independent of the timeouts.

## Finding 2: next_creative_analysis_account scans every creative of every enabled account

The function asks, for each of the 12 accounts with `creative_analysis_enabled`, whether any creative is `pending`, or `analyzing` for more than 4 minutes. Production `EXPLAIN` (read-only): for each account the planner scans `idx_creatives_account_created` and filters, removing 4,229 rows per account, reading 30,564 buffers from cache and 18,439 from disk, **8.9 s**, result 0 rows. Right now no enabled account has pending work (the 1,457 pending rows belong to accounts that are not enabled), so the full scan runs every 2 minutes and finds nothing. Every run that exceeds the limit is a 500 to the cron job; the cron job only logs it.

### Proposed change

A small partial index on the rows that matter, and the function told to use it:

```sql
create index concurrently if not exists creatives_analysis_work_idx
  on public.creatives (account_id)
  where analysis_status in ('pending', 'analyzing');
```

```sql
create or replace function public.next_creative_analysis_account()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select a.id
  from public.ad_accounts a
  where a.creative_analysis_enabled
    and exists (
      select 1 from public.creatives c
      where c.account_id = a.id
        and c.analysis_status in ('pending', 'analyzing')
        and (c.analysis_status = 'pending' or c.updated_at < now() - interval '4 minutes')
    )
    and not exists (
      select 1 from public.creative_analysis_spend s
      where s.account_id = a.id and s.spent_usd >= s.cap_usd
    )
  order by a.id
  limit 1;
$function$;
```

The rewrite returns the same rows as the current text: the added `in (...)` condition is implied by the original `or`, and it lets the planner use the partial index, which holds about 1,500 rows instead of 52,000.

### Staging test and what it did not prove

The scratch test (52,000 creatives over 12 accounts, plus 1,450 pending rows for another account) showed the rewritten query using the new partial index with 2 buffers, 0.04 ms. It did not reproduce production's bad plan: on the scratch table the planner already picked the existing `(account_id, analysis_status)` index for the original form (4 buffers, 0.05 ms). So the benefit on production is expected from the plan above, not shown. Verification after the index is built is read-only and safe: run the production `EXPLAIN` again and confirm buffers fall from about 49,000 to a handful. If it does not, the function change can be reverted by re-running the current definition above.

## Finding 3: the cache is cold and the table needs a vacuum

Both plans read tens of thousands of pages from disk (`read=28249`, `read=18439`) and the first one wrote 4,504 pages while reading, which is hint-bit setting after a bulk load. `creative_daily_metrics` has 71,136 dead rows and was last vacuumed on 2026-11-11. Timeouts may ease on their own as the cache warms, but the first page of a cold query still takes longer than 8 s.

Proposed, low risk: `vacuum (analyze) public.creative_daily_metrics;` once, outside peak hours. Also check the project's compute size in the Supabase dashboard; the database is 2.9 GB and a small instance cannot hold the hot set in memory.

## Not diagnosed

`get_period_metrics` (7 x 500 and 5 x 502, plus the known 403s from the client home). Its body has not been read. Re-check after the two indexes and the vacuum; if it still times out, read its plan the same way.

## Suggested order, each needing an owner go

1. `vacuum (analyze) public.creative_daily_metrics;`
2. `idx_daily_metrics_date` (one statement, concurrently).
3. `creatives_analysis_work_idx`, then the function rewrite.
4. Read-only re-check: timeouts per hour in the function and edge logs, and the two `EXPLAIN` plans.

Rollback: `drop index concurrently idx_daily_metrics_date;`, `drop index concurrently creatives_analysis_work_idx;`, and re-create the function from its current definition. None of these touches data.
