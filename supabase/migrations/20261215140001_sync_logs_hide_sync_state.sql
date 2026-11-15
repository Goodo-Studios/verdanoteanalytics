-- Hide sync_logs.sync_state from client roles.
--
-- sync_state holds resumable sync cursors. Older runs stored full Meta Graph URLs there, and
-- those URLs embed access_token=. A client login can SELECT sync_logs for its linked accounts
-- (policy "Client can view linked sync_logs"), so the Meta token was readable through PostgREST.
-- The sync function now stores token-free cursors, but existing rows may still hold tokens.
--
-- A column-level REVOKE does nothing while a table-level SELECT grant exists, so this removes the
-- table-level SELECT from anon and authenticated and grants SELECT back on every column except
-- sync_state. The column list is read from the catalog so columns added by earlier migrations are
-- included. service_role is untouched and keeps full access (the sync and cleanup functions, and
-- the /sync/history endpoint, read the table as service_role; the endpoint also scrubs cursors
-- from sync_state before returning it). Staff keep the row rules and every other column. The app
-- reads sync_logs directly only with explicit column lists that omit sync_state.
--
-- This migration does not rewrite existing rows. Scrubbing already-stored tokens needs separate
-- owner approval, and the Meta token should be rotated.

REVOKE SELECT ON public.sync_logs FROM anon, authenticated;

DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'sync_logs'
     AND column_name <> 'sync_state';

  EXECUTE format('GRANT SELECT (%s) ON public.sync_logs TO anon, authenticated', cols);
END
$$;
