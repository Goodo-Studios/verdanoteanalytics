-- creative_filter_values (audit plan item 7.3, part 2): every distinct product, theme and hook,
-- scoped to the caller's accounts, service_role only.
--
-- Run with the local stack (requires Docker):  supabase test db
-- All rows are made up.

BEGIN;
SELECT plan(7);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_cfv_a', 'CFV A', now()), ('act_cfv_b', 'CFV B', now());
INSERT INTO public.creatives (ad_id, account_id, ad_name, product, theme, hook)
SELECT 'cfv_' || i, CASE WHEN i % 2 = 0 THEN 'act_cfv_a' ELSE 'act_cfv_b' END, 'Ad ' || i,
       'cfvP' || (i % 1200), 'cfvT' || (i % 1200), CASE WHEN i % 3 = 0 THEN NULL ELSE 'cfvH' || (i % 1200) END
  FROM generate_series(1, 2500) AS i;

CREATE TEMP TABLE fv AS SELECT public.creative_filter_values(ARRAY['act_cfv_a', 'act_cfv_b']) AS j;

SELECT is((SELECT jsonb_array_length(j->'product') FROM fv), 1200, 'every product, not the first 1,000 rows');
SELECT is((SELECT jsonb_array_length(j->'theme') FROM fv), 1200, 'every theme');
SELECT ok((SELECT j->'hook' ? 'cfvH1199' AND NOT (j->'hook' @> 'null'::jsonb) FROM fv), 'hooks include late values and no nulls');
SELECT is((SELECT jsonb_array_length(public.creative_filter_values(ARRAY['act_cfv_a'])->'product')), 600,
  'scoped to the caller''s accounts');
SELECT ok(has_function_privilege('service_role', 'public.creative_filter_values(text[])', 'EXECUTE'), 'service_role can execute');
SELECT ok(NOT has_function_privilege('authenticated', 'public.creative_filter_values(text[])', 'EXECUTE'), 'authenticated cannot execute');
SELECT ok(NOT has_function_privilege('anon', 'public.creative_filter_values(text[])', 'EXECUTE'), 'anon cannot execute');

SELECT * FROM finish();
ROLLBACK;
