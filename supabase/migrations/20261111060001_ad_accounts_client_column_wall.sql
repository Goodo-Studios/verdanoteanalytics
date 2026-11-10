-- Clients stop reading ad_accounts directly.
--
-- The row rule "Client can view linked accounts" let a client login run
-- `select * from ad_accounts` through the REST API with its own token and get every
-- column of its linked accounts: AI prompts, kill and scale thresholds, client
-- responsiveness, attribution notes, targets and the TikTok access token. Row rules
-- limit rows, not columns.
--
-- Why not column grants: staff and clients use the same `authenticated` role, so a
-- column revoke would also break the staff pages that read and update ad_accounts
-- directly (Settings, Data health, Sync schedule, Ad Name Generator, rename).
--
-- Instead the client row rule is dropped. Clients read their accounts only through
-- the `accounts` edge function, which checks the user_accounts link and returns an
-- allow-listed set of columns (supabase/functions/_shared/client-account-fields.ts).
-- No client page reads ad_accounts directly; staff keep the "Builder/employee can
-- manage accounts" rule unchanged.
--
-- Effect on ai-chat: it reads through the caller's own session, so for a client it no
-- longer sees the account name or targets. It has no client page and is unchanged
-- for staff.

DROP POLICY IF EXISTS "Client can view linked accounts" ON public.ad_accounts;

COMMENT ON TABLE public.ad_accounts IS
  'Ad accounts. Staff only through the REST API (row rule "Builder/employee can manage accounts"). Clients read their linked accounts through the accounts edge function, which returns only the client-safe columns listed in supabase/functions/_shared/client-account-fields.ts.';
