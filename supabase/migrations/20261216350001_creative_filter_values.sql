-- Audit plan item 7.3, part 2: the Creatives filter menus list every value.
--
-- GET /creatives/filters read products and themes with plain selects, which PostgREST caps at
-- 1,000 rows, so with about 52,000 creatives most products and themes never reached the menus.
-- Hooks were paged 1,000 rows at a time, up to 50 requests. This function returns the
-- distinct values in one call, scoped like the old queries (p_allowed_ids NULL = every
-- account). It trusts p_allowed_ids, so it is service_role only, like creatives_list_page.

CREATE OR REPLACE FUNCTION public.creative_filter_values(p_allowed_ids text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH scoped AS (
    SELECT c.product, c.theme, c.hook
      FROM public.creatives c
     WHERE p_allowed_ids IS NULL OR c.account_id = ANY (p_allowed_ids)
  )
  SELECT jsonb_build_object(
    'product', COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT product AS v FROM scoped WHERE product IS NOT NULL) s), '[]'::jsonb),
    'theme',   COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT theme   AS v FROM scoped WHERE theme   IS NOT NULL) s), '[]'::jsonb),
    'hook',    COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT hook    AS v FROM scoped WHERE hook    IS NOT NULL) s), '[]'::jsonb)
  )
$$;

COMMENT ON FUNCTION public.creative_filter_values(text[]) IS
  'Distinct product, theme and hook values for the Creatives filter menus (GET /creatives/filters). Trusts p_allowed_ids, so service_role only (audit 7.3).';

REVOKE ALL ON FUNCTION public.creative_filter_values(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creative_filter_values(text[]) TO service_role;
