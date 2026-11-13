-- Brain links on tasks and ask-the-Brain passages (migration 20261204080001, story OS-026).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the content type map has row rules, staff read it and only a builder writes it; a
-- client reads none of it. brain_playbook_for_content_type uses the map first, then a Playbooks
-- heading, then a Playbooks title, and returns nothing for an unknown type; a client and anon
-- cannot call it. brain_answer_passages returns matching paragraphs with their page for the
-- service role, nothing for an unrelated question, and a client, an employee and anon cannot
-- call it at all (only the brain-ask edge function, as the service role, does).
-- All rows are made up.

BEGIN;
SELECT plan(21);

INSERT INTO auth.users (id, email) VALUES
  ('e5260000-0000-4000-8000-000000000001', 'bl-builder@example.test'),
  ('e5260000-0000-4000-8000-000000000002', 'bl-employee@example.test'),
  ('e5260000-0000-4000-8000-000000000003', 'bl-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e5260000-0000-4000-8000-000000000001', 'builder'),
  ('e5260000-0000-4000-8000-000000000002', 'employee'),
  ('e5260000-0000-4000-8000-000000000003', 'client');

INSERT INTO public.brain_pages (section, slug, title, body_md, owner, source_path, content_hash) VALUES
  ('Playbooks', 'bl-video-playbook', 'Bl video playbook',
   E'# Video\n\nIntro text.\n\n## Founder Story\n\nFilm the founder at the workbench in daylight.\n\n## Unboxing Reel\n\nOpen the box slowly and keep the logo in frame.',
   'Unassigned', 'processes/bl-video-playbook.md', 'h1'),
  ('Playbooks', 'bl-static-ads', 'Bl Static Ads', E'Static ads use one bold headline.', 'Unassigned', 'processes/bl-static-ads.md', 'h2'),
  ('Handbook', 'bl-mapped', 'Bl mapped page', E'# Mapped\n\n## Hook Bank\n\nThree hooks per brief.', 'Unassigned', 'company/bl-mapped.md', 'h3');

INSERT INTO public.brain_playbook_links (content_type, section, slug, anchor) VALUES
  ('bl ugc testimonial', 'Handbook', 'bl-mapped', 'hook-bank');

-- ---------------------------------------------------------------- structure (1-3)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brain_playbook_links'::regclass), 'row rules are on for brain_playbook_links');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'brain_playbook_links' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on brain_playbook_links');
SELECT throws_ok($$INSERT INTO public.brain_playbook_links (content_type, slug) VALUES ('Not Lower', 'x')$$,
  '23514', NULL, 'a content type is stored lower-cased and trimmed');

-- ---------------------------------------------------------------- staff read, builder writes (4-7)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e5260000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.brain_playbook_links WHERE content_type = 'bl ugc testimonial'), 1, 'an employee reads the map');
SELECT throws_ok($$INSERT INTO public.brain_playbook_links (content_type, slug) VALUES ('bl employee', 'x')$$,
  '42501', NULL, 'an employee cannot add to the map');
SELECT set_config('request.jwt.claim.sub', 'e5260000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$INSERT INTO public.brain_playbook_links (content_type, slug) VALUES ('bl builder type', 'bl-static-ads')$$,
  'a builder adds to the map');

-- ---------------------------------------------------------------- playbook lookup as staff (7-11)
SELECT set_config('request.jwt.claim.sub', 'e5260000-0000-4000-8000-000000000002', true);
SELECT results_eq($$SELECT section, slug, anchor, heading FROM public.brain_playbook_for_content_type('  BL UGC   Testimonial ')$$,
  $$VALUES ('Handbook'::text, 'bl-mapped'::text, 'hook-bank'::text, 'Hook Bank'::text)$$,
  'the map wins, ignoring case and spaces, and names the heading');
SELECT results_eq($$SELECT section, slug, anchor, heading FROM public.brain_playbook_for_content_type('founder story')$$,
  $$VALUES ('Playbooks'::text, 'bl-video-playbook'::text, 'founder-story'::text, 'Founder Story'::text)$$,
  'without a map row, a Playbooks heading equal to the content type matches');
SELECT results_eq($$SELECT slug, anchor FROM public.brain_playbook_for_content_type('Bl static ads')$$,
  $$VALUES ('bl-static-ads'::text, NULL::text)$$,
  'then a Playbooks page titled with the content type matches, with no heading');
SELECT is_empty($$SELECT * FROM public.brain_playbook_for_content_type('bl nothing like this')$$, 'an unknown content type returns nothing');
SELECT is_empty($$SELECT * FROM public.brain_playbook_for_content_type('')$$, 'an empty content type returns nothing');

-- ---------------------------------------------------------------- a client gets nothing (12-15)
SELECT set_config('request.jwt.claim.sub', 'e5260000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.brain_playbook_links), 0, 'a client reads nothing from the map');
SELECT throws_ok($$SELECT * FROM public.brain_playbook_for_content_type('founder story')$$,
  '42501', NULL, 'a client cannot look up a playbook');
SELECT throws_ok($$SELECT * FROM public.brain_answer_passages('how do we film the founder', 6)$$,
  '42501', NULL, 'a client cannot call brain_answer_passages');
SELECT ok(NOT has_function_privilege('authenticated', 'public.brain_answer_passages(text, integer)', 'EXECUTE'),
  'no signed-in user (client or staff) holds execute on brain_answer_passages');

-- ---------------------------------------------------------------- staff cannot call passages directly (16)
SELECT set_config('request.jwt.claim.sub', 'e5260000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT * FROM public.brain_answer_passages('how do we film the founder', 6)$$,
  '42501', NULL, 'an employee goes through the brain-ask function, not the database function');

-- ---------------------------------------------------------------- anon (17-18)
RESET role;
SET LOCAL role anon;
SELECT throws_ok($$SELECT * FROM public.brain_playbook_for_content_type('founder story')$$, '42501', NULL, 'anon cannot look up a playbook');
SELECT throws_ok($$SELECT * FROM public.brain_answer_passages('founder', 6)$$, '42501', NULL, 'anon cannot call brain_answer_passages');

-- ---------------------------------------------------------------- service role passages (19-21)
RESET role;
SET LOCAL role service_role;
SELECT results_eq($$SELECT slug, passage FROM public.brain_answer_passages('How do we film the founder in daylight?', 6) LIMIT 1$$,
  $$VALUES ('bl-video-playbook'::text, 'Film the founder at the workbench in daylight.'::text)$$,
  'the best matching paragraph comes first, with its page');
SELECT is_empty($$SELECT * FROM public.brain_answer_passages('quarterly payroll tax filing deadline', 6)$$,
  'a question nothing in the Brain covers returns nothing');
SELECT is_empty($$SELECT * FROM public.brain_answer_passages('the and of', 6)$$,
  'a question of only stop words returns nothing');

SELECT * FROM finish();
ROLLBACK;
