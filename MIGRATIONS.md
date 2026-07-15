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
