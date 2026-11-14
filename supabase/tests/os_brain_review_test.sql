-- Keep the Brain current (migration 20261129080001, story OS-016).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: owner text matches a staff login by name or email (case-insensitive, trimmed), not a
-- client login and not an ambiguous name; the rematch function reports owners with no login;
-- my_brain_pages_to_review returns only the caller's pages past 90 days (or never reviewed);
-- any staff member suggests a fix; the page owner and a builder accept or reject it, a staff
-- member who is not the owner cannot, nobody reviews their own fix; a client can neither suggest
-- nor see fixes; fixes and reviews are immutable; accepting leaves brain_pages unchanged.
-- All rows are made up.

BEGIN;
SELECT plan(32);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e5160000-0000-4000-8000-000000000001', 'br-builder@example.test', '{"full_name": "Bea Builder"}'),
  ('e5160000-0000-4000-8000-000000000002', 'br-owner@example.test', '{}'),
  ('e5160000-0000-4000-8000-000000000003', 'br-other@example.test', '{"name": "Olly Other"}'),
  ('e5160000-0000-4000-8000-000000000004', 'br-client@example.test', '{"full_name": "Cleo Client"}'),
  ('e5160000-0000-4000-8000-000000000005', 'br-twin-a@example.test', '{"full_name": "Sam Twin"}'),
  ('e5160000-0000-4000-8000-000000000006', 'br-twin-b@example.test', '{"full_name": "Sam Twin"}');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e5160000-0000-4000-8000-000000000001', 'builder'),
  ('e5160000-0000-4000-8000-000000000002', 'employee'),
  ('e5160000-0000-4000-8000-000000000003', 'employee'),
  ('e5160000-0000-4000-8000-000000000004', 'client'),
  ('e5160000-0000-4000-8000-000000000005', 'employee'),
  ('e5160000-0000-4000-8000-000000000006', 'employee');
INSERT INTO public.profiles (user_id, email, display_name) VALUES
  ('e5160000-0000-4000-8000-000000000002', 'br-owner@example.test', 'Olivia Owner')
ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name;

INSERT INTO public.brain_pages (section, slug, title, body_md, owner, last_reviewed, source_path, content_hash) VALUES
  ('Handbook', 'br-old', 'Old page', 'Old text', '  olivia owner ', current_date - 91, 'company/br-old.md', 'hash-old'),
  ('Handbook', 'br-edge', 'Edge page', 'Edge text', 'Olivia Owner', current_date - 90, 'company/br-edge.md', 'hash-edge'),
  ('Handbook', 'br-fresh', 'Fresh page', 'Fresh text', 'BR-OWNER@example.test', current_date - 89, 'company/br-fresh.md', 'hash-fresh'),
  ('Handbook', 'br-never', 'Never page', 'Never text', 'Olivia Owner', NULL, 'company/br-never.md', 'hash-never'),
  ('Playbooks', 'br-others', 'Other owner page', 'Other text', 'Olly Other', current_date - 200, 'processes/br-others.md', 'hash-others'),
  ('Playbooks', 'br-client', 'Client named page', 'Text', 'Cleo Client', current_date - 200, 'processes/br-client.md', 'hash-client'),
  ('Playbooks', 'br-twin', 'Twin page', 'Text', 'Sam Twin', current_date - 200, 'processes/br-twin.md', 'hash-twin'),
  ('Insights', 'br-nobody', 'Nobody page', 'Text', 'Nobody Known', current_date - 200, 'insights/br-nobody.md', 'hash-nobody'),
  ('Insights', 'br-unassigned', 'Unassigned page', 'Text', 'Unassigned', current_date - 200, 'insights/br-unassigned.md', 'hash-unassigned');

-- ---------------------------------------------------------------- owner matching (1-7)
SELECT is((SELECT owner_user_id FROM public.brain_pages WHERE slug = 'br-old'), 'e5160000-0000-4000-8000-000000000002'::uuid,
  'a profile display name matches, ignoring case and spaces');
SELECT is((SELECT owner_user_id FROM public.brain_pages WHERE slug = 'br-fresh'), 'e5160000-0000-4000-8000-000000000002'::uuid,
  'an email owner matches the login email, ignoring case');
SELECT is((SELECT owner_user_id FROM public.brain_pages WHERE slug = 'br-others'), 'e5160000-0000-4000-8000-000000000003'::uuid,
  'a name in the login details matches');
SELECT is((SELECT owner_user_id FROM public.brain_pages WHERE slug = 'br-client'), NULL, 'a client login is never an owner');
SELECT is((SELECT owner_user_id FROM public.brain_pages WHERE slug = 'br-twin'), NULL, 'a name shared by two logins matches nobody');
SELECT is((SELECT owner_user_id FROM public.brain_pages WHERE slug = 'br-unassigned'), NULL, 'Unassigned matches nobody');

SET LOCAL role service_role;
SELECT results_eq(
  $$SELECT owner, pages FROM public.rematch_brain_page_owners() WHERE owner IN ('Cleo Client', 'Sam Twin', 'Nobody Known', 'Unassigned') ORDER BY owner$$,
  $$VALUES ('Cleo Client'::text, 1), ('Nobody Known'::text, 1), ('Sam Twin'::text, 1)$$,
  'the rematch reports owners with no staff login, not Unassigned');
RESET role;

-- ---------------------------------------------------------------- grants (8-10)
SELECT ok(NOT has_function_privilege('authenticated', 'public.rematch_brain_page_owners()', 'EXECUTE'),
  'signed-in users cannot run the owner rematch');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brain_page_corrections'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brain_page_correction_reviews'::regclass),
  'row rules are on for both fix tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('brain_page_corrections', 'brain_page_correction_reviews')
              AND (grantee IN ('anon', 'PUBLIC') OR (grantee = 'authenticated' AND privilege_type <> 'SELECT'))), 0,
  'anon holds nothing and signed-in users only read the fix tables');

-- ---------------------------------------------------------------- needs review (11-14)
SELECT ok(public.brain_page_needs_review(current_date - 91) AND NOT public.brain_page_needs_review(current_date - 90)
  AND NOT public.brain_page_needs_review(current_date - 89) AND public.brain_page_needs_review(NULL),
  'needs review: 91 days yes, 90 and 89 days no, never reviewed yes');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000002', true);
SELECT results_eq(
  $$SELECT slug FROM public.my_brain_pages_to_review()$$,
  $$VALUES ('br-never'::text), ('br-old'::text)$$,
  'the owner gets only their own pages past 90 days, never reviewed first');
SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000003', true);
SELECT results_eq($$SELECT slug FROM public.my_brain_pages_to_review()$$, $$VALUES ('br-others'::text)$$,
  'another owner gets only their own page');
SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.my_brain_pages_to_review()), 0, 'a client gets no pages to review');

-- ---------------------------------------------------------------- suggest a fix (15-19)
SELECT throws_ok($$SELECT public.submit_brain_page_correction((SELECT id FROM public.brain_pages WHERE slug = 'br-old'), 'hash-old', 'Client text', 'Because', 'content')$$,
  '42501', NULL, 'a client cannot suggest a fix');

SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$SELECT public.submit_brain_page_correction(
    (SELECT id FROM public.brain_pages WHERE slug = 'br-old'), 'hash-old', 'New text', 'The old text is wrong', 'factual')$$,
  'an employee who is not the owner suggests a fix');
SELECT throws_ok($$SELECT public.submit_brain_page_correction((SELECT id FROM public.brain_pages WHERE slug = 'br-old'), 'hash-stale', 'Newer', 'Why', 'content')$$,
  '40001', NULL, 'a fix against a page that was published again is refused');
SELECT throws_ok($$SELECT public.submit_brain_page_correction((SELECT id FROM public.brain_pages WHERE slug = 'br-old'), 'hash-old', 'Old text', 'Why', 'content')$$,
  '22023', NULL, 'a fix with the same text is refused');
SELECT lives_ok($$SELECT public.submit_brain_page_correction(
    (SELECT id FROM public.brain_pages WHERE slug = 'br-old'), 'hash-old', 'Second text', 'Another fix', 'content')$$,
  'a second fix to the same page is fine');

-- ---------------------------------------------------------------- review (20-27)
SELECT throws_ok($$SELECT public.review_brain_page_correction((SELECT id FROM public.brain_page_corrections WHERE proposed_body = 'New text'), 'accepted', 'Mine')$$,
  '42501', NULL, 'nobody reviews their own fix');

SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000005', true);
SELECT throws_ok($$SELECT public.review_brain_page_correction((SELECT id FROM public.brain_page_corrections WHERE proposed_body = 'New text'), 'accepted', 'Looks right')$$,
  '42501', NULL, 'an employee who is not the owner cannot accept a fix');

SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$SELECT public.submit_brain_page_correction(
    (SELECT id FROM public.brain_pages WHERE slug = 'br-nobody'), 'hash-nobody', 'Nobody fix', 'Owner unknown', 'content')$$,
  'an employee suggests a fix to a page whose owner matched nobody');
SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000005', true);
SELECT throws_ok($$SELECT public.review_brain_page_correction((SELECT id FROM public.brain_page_corrections WHERE proposed_body = 'Nobody fix'), 'accepted', 'Sure')$$,
  '42501', NULL, 'on a page with no matched owner an employee cannot accept a fix');

SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$SELECT public.review_brain_page_correction((SELECT id FROM public.brain_page_corrections WHERE proposed_body = 'New text'), 'rejected', 'No')$$,
  '42501', NULL, 'a client cannot review a fix');
SELECT is((SELECT count(*)::int FROM public.brain_page_corrections), 0, 'a client sees no fixes');

SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$SELECT public.review_brain_page_correction((SELECT id FROM public.brain_page_corrections WHERE proposed_body = 'New text'), 'accepted', 'Right, will update HQ')$$,
  'the page owner accepts a fix');
SELECT throws_ok($$SELECT public.review_brain_page_correction((SELECT id FROM public.brain_page_corrections WHERE proposed_body = 'New text'), 'rejected', 'Changed my mind')$$,
  '23505', NULL, 'a fix has one decision only');

SELECT set_config('request.jwt.claim.sub', 'e5160000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$SELECT public.review_brain_page_correction((SELECT id FROM public.brain_page_corrections WHERE proposed_body = 'Second text'), 'rejected', 'Not needed')$$,
  'a builder rejects a fix on a page they do not own');
SELECT results_eq(
  $$SELECT c.proposed_body, r.decision FROM public.brain_page_corrections c JOIN public.brain_page_correction_reviews r ON r.correction_id = c.id ORDER BY c.proposed_body$$,
  $$VALUES ('New text'::text, 'accepted'::text), ('Second text'::text, 'rejected'::text)$$,
  'staff read both fixes and their decisions');

-- ---------------------------------------------------------------- HQ stays the source (28-30)
RESET role;
SELECT is((SELECT body_md || '|' || content_hash FROM public.brain_pages WHERE slug = 'br-old'), 'Old text|hash-old',
  'accepting a fix does not change the Brain page');
SELECT throws_ok($$UPDATE public.brain_page_corrections SET reason = 'x'$$, '23514', NULL, 'a fix cannot be changed');
SELECT throws_ok($$DELETE FROM public.brain_page_correction_reviews$$, '23514', NULL, 'a decision cannot be removed');

SELECT * FROM finish();
ROLLBACK;
