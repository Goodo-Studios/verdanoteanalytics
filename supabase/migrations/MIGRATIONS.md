# Creative Library (Feature 4 + F3 + F6) — migration notes

These migrations use **placeholder** numbers in the `20260716000001…` range.
They are additive, idempotent, and safe to re-run.

## For the orchestrator

1. **Renumber** the two migration files to the next free timestamp slots at
   apply time (keep their relative order — `..._media_archive_durable` MUST run
   before `..._rpc_creative_classification_library`, because
   `get_creative_library` LEFT JOINs `media_archive`).
2. Run `supabase db push` to apply them.
3. `./scripts/deploy-functions.sh` to deploy the two new edge functions
   (`creative-library`, `creative-media-archive`) — already added to the
   `FUNCTIONS` list and to `supabase/config.toml` (`verify_jwt = false`, they do
   their own session-JWT verification like `leaderboard`).

## Files (in apply order)

| Placeholder | File | Purpose |
|---|---|---|
| `20260716000001` | `20260716000001_media_archive_durable.sql` | F3 durable media archive: `media_archive` (references `media_assets`, `retention='keep'`, captures transcript/framework/perf snapshot at archive time) + `media_archive_export_jobs` (bulk-zip tracking) + private `creative-archive` storage bucket + RLS mirroring `media_assets`. |
| `20260716000002` | `20260716000002_rpc_creative_classification_library.sql` | F6 + Feature 4 RPCs: `get_creative_classification` (window roll-up + recent/prior trend split for the shared classifier) and `get_creative_library` (every live creative + window perf + trend + media + durability + vault presence). Both **SECURITY DEFINER, trust `p_account_id`** → `authenticated` EXECUTE **revoked**, `service_role` only. |

## Security posture (must hold in prod)

- The two RPCs trust `p_account_id`, so a raw `authenticated` EXECUTE would be a
  cross-account IDOR. `authenticated`/`PUBLIC` EXECUTE is **revoked**; only
  `service_role` may call them.
- The **only** sanctioned caller is the session-authed `creative-library` edge
  function, which verifies the caller's JWT and enforces
  `verifyAccountOwnership()` before invoking with the service-role client
  (mirrors `supabase/functions/leaderboard/index.ts`).
- The `creative-archive` bucket is **private**; zips download via short-lived
  signed URLs only.

## Verify after push

```sql
-- RPC lockdown
SELECT has_function_privilege('authenticated','public.get_creative_library(text,date,date)','EXECUTE'); -- expect false
SELECT has_function_privilege('service_role','public.get_creative_library(text,date,date)','EXECUTE');  -- expect true
-- Tables + bucket
SELECT policyname FROM pg_policies WHERE tablename IN ('media_archive','media_archive_export_jobs');
SELECT id, public FROM storage.buckets WHERE id = 'creative-archive';  -- public = false
```
