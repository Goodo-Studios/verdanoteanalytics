-- One-row lookups for shared report and brief links (audit plan item 1.3, release step 1 of 3).
--
-- Today the public report page and the public brief page read the tables directly, which works
-- only because of the policies "Public can view shared reports" (is_public = true) and
-- "Public can view briefs explicitly marked shared" (is_shared IS TRUE). Those policies also let
-- anyone LIST every shared report and brief without a link.
--
-- Step 1 (this migration): add lookups that return only the row the link names. The pages move
-- to them in the same change. Step 2: confirm the live site uses them. Step 3: drop the two open
-- policies in a separate release.
--
-- Both functions return the table's row type, which is what the pages read today (no new
-- columns are exposed). Report ids are random UUIDs and brief share tokens are random, so
-- existing links keep working.

CREATE OR REPLACE FUNCTION public.get_public_report(p_id uuid)
RETURNS SETOF public.reports
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.* FROM public.reports r WHERE r.id = p_id AND r.is_public IS TRUE LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_shared_brief(p_token text)
RETURNS SETOF public.briefs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.* FROM public.briefs b
   WHERE p_token IS NOT NULL AND length(p_token) >= 16
     AND b.share_token = p_token AND b.is_shared IS TRUE
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_report(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shared_brief(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_report(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_brief(text) TO anon, authenticated;
