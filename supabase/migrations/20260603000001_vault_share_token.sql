-- =============================================================================
-- Vault share-link: public, revocable share tokens for a single inspiration item
-- =============================================================================
-- Adds a per-item share token so any authenticated user can mint a public,
-- no-login link to one saved ad (creative + AI analysis), and revoke it later.
--
-- Design notes:
--   • NO new RLS policy on inspiration_items. The public viewer never touches
--     the DB with an anon client — the `vault-share-item` edge function resolves
--     the token with the service role (bypassing RLS) and returns an explicit
--     column allowlist. This keeps the global library authenticated-only and
--     avoids exposing internal columns (user_id, performance_snapshot, …) via a
--     broad anon SELECT policy.
--   • Mint/revoke also run through the edge function (service role) because
--     inspiration_items UPDATE RLS is owner-scoped (user_id = auth.uid()) but the
--     library is global — any authenticated user may share any item.
--   • share_token nullable: NULL = not shared / revoked. shared_at records when.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
-- Verdanote project_id = gwyxaqoaldnaavkjqquv.
-- =============================================================================

alter table public.inspiration_items
  add column if not exists share_token text;
alter table public.inspiration_items
  add column if not exists shared_at timestamptz;

comment on column public.inspiration_items.share_token is
  'Opaque public share token (12-char). NULL = not shared / revoked. Resolved by the vault-share-item edge function for the public /vault/share/:token view.';
comment on column public.inspiration_items.shared_at is
  'Timestamp the current share_token was minted. NULL when not shared.';

-- Unique only over live tokens; multiple NULLs (un-shared items) are allowed.
create unique index if not exists inspiration_items_share_token_idx
  on public.inspiration_items(share_token)
  where share_token is not null;
