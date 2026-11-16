-- Close direct access to slack_connections (audit plan item 0.3).
--
-- The insert and update policies only checked user_id = auth.uid(), so any signed-in user
-- (clients included, and anyone who signs up) could write a row with any team_id, bot_token and
-- signing_secret straight through PostgREST. vault-slack-events trusted those rows: it verified
-- events against one connection's secret, then sent every connection's bot token to a URL taken
-- from the event. Slack import was never used from the app, so the three vault-slack functions are
-- removed in the same change and the table is closed to client roles.
--
-- The table is kept (0 rows in production on 2026-11-15) so it can be dropped in a later cleanup
-- once the deployed functions are deleted from the production project. service_role keeps access.

DROP POLICY IF EXISTS "slack_connections_insert" ON public.slack_connections;
DROP POLICY IF EXISTS "slack_connections_update" ON public.slack_connections;
DROP POLICY IF EXISTS "slack_connections_select" ON public.slack_connections;
DROP POLICY IF EXISTS "slack_connections_delete" ON public.slack_connections;

REVOKE ALL ON public.slack_connections FROM anon, authenticated;
