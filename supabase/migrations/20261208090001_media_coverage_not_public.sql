-- public.media_coverage (created by 20260714000024 and replaced several times since) is a plain
-- view owned by postgres. A view runs with its owner's rights unless security_invoker is set, and
-- the default grants of the public schema give anon SELECT on every new view. Together that let
-- anyone holding the public anon key read the whole view without signing in: ad id, ad account id,
-- ad name, status, impressions and the media coverage flags of every client's ads (47,331 rows when
-- checked on production, 2026-11-14), because the creatives row rules never applied.
--
-- Two changes, both safe to run again:
--   1. security_invoker = true, so the view applies the caller's row rules on creatives. Staff keep
--      reading it through their own builder/employee policies; a client sees only linked accounts.
--   2. Take every grant away from anon and PUBLIC. authenticated and service_role keep theirs.
--
-- The functions that read the view (snapshot_media_coverage, rpc_media_coverage) are SECURITY
-- DEFINER and run as the owner, so the cron jobs and the health check are unchanged.
--
-- A future migration that drops and recreates the view must set security_invoker again and repeat
-- the REVOKE, because a new view starts with the schema's default grants.

ALTER VIEW public.media_coverage SET (security_invoker = true);

REVOKE ALL ON public.media_coverage FROM anon;
REVOKE ALL ON public.media_coverage FROM PUBLIC;
