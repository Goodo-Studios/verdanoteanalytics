-- Cmd+K search, os_search (migration 20261127080001, story OS-015).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the function is definer with a fixed search_path, anon cannot call it; a phrase found
-- only in a page body finds that page for staff, with the matched word marked in the snippet;
-- staff results have pages, tasks and clients; read-only tasks are left out; a client gets no
-- pages even for an exact title, only their own clients' visible tasks (also when linked by ad
-- account only), and only their own clients; a signed-in user with no role and a call with no
-- sign-in get nothing; a one-letter query gets nothing. All rows are made up.

BEGIN;
SELECT plan(22);

INSERT INTO auth.users (id, email) VALUES
  ('e1500000-0000-4000-8000-000000000001', 'os-builder@example.test'),
  ('e1500000-0000-4000-8000-000000000002', 'os-employee@example.test'),
  ('e1500000-0000-4000-8000-000000000003', 'os-client@example.test'),
  ('e1500000-0000-4000-8000-000000000004', 'os-adclient@example.test'),
  ('e1500000-0000-4000-8000-000000000005', 'os-norole@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e1500000-0000-4000-8000-000000000001', 'builder'),
  ('e1500000-0000-4000-8000-000000000002', 'employee'),
  ('e1500000-0000-4000-8000-000000000003', 'client'),
  ('e1500000-0000-4000-8000-000000000004', 'client');

INSERT INTO public.clients (slug, name, status) VALUES
  ('os-zephyr', 'Zephyr Quill', 'active'),
  ('os-harbor', 'Harbor Quill', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e1500000-0000-4000-8000-000000000003', 'os-zephyr');
-- A client login that reaches os-zephyr only through an ad account.
INSERT INTO public.ad_accounts (id, name) VALUES ('act_os_zephyr', 'Zephyr Meta');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_os_zephyr', 'os-zephyr');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('e1500000-0000-4000-8000-000000000004', 'act_os_zephyr');

INSERT INTO public.brain_pages (section, slug, title, body_md, source_path, content_hash) VALUES
  ('Playbooks', 'os-cutting-rules', 'Cutting rules',
   E'# Cutting rules\n\nIntro line.\n\n- No **flamboyant marmalade** transitions on creator cuts\n- Keep it short',
   'processes/os-cutting-rules.md', 'h1'),
  ('Handbook', 'os-pelican-handbook', 'Pelican handbook', E'# Pelican handbook\n\nNothing secret.',
   'company/os-pelican-handbook.md', 'h2');

INSERT INTO public.os_tasks (id, client_slug, title, clickup_list_id, is_asset, read_only) VALUES
  ('e1520000-0000-4000-8000-000000000001', 'os-zephyr', 'Quill launch hook edit', NULL, false, false),
  ('e1520000-0000-4000-8000-000000000002', 'os-harbor', 'Quill harbor hook edit', NULL, false, false),
  ('e1520000-0000-4000-8000-000000000003', 'os-zephyr', 'Quill archived hook edit', 'l-old', true, true),
  ('e1520000-0000-4000-8000-000000000004', 'os-zephyr', 'Quill kickoff call', 'l-calls', false, false);

-- ---------------------------------------------------------------- structure (1-3)
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.os_search(text, int)'::regprocedure),
  'os_search is security definer');
SELECT ok((SELECT proconfig::text ~ 'search_path=public' FROM pg_proc WHERE oid = 'public.os_search(text, int)'::regprocedure),
  'os_search sets its search_path');
SELECT ok(NOT has_function_privilege('anon', 'public.os_search(text, int)', 'EXECUTE'), 'anon cannot call os_search');

-- ---------------------------------------------------------------- builder (4-11)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);

SELECT is((SELECT count(*)::int FROM public.os_search('flamboyant marmalade') WHERE kind = 'page' AND title = 'Cutting rules'), 1,
  'a phrase only in a page body finds that page for a builder');
SELECT ok((SELECT snippet FROM public.os_search('flamboyant marmalade') WHERE kind = 'page' AND title = 'Cutting rules') ~ '⟦flamboyant⟧',
  'the snippet marks the matched word');
SELECT ok((SELECT snippet !~ '\*\*' AND snippet !~ '^- ' FROM public.os_search('flamboyant marmalade') WHERE kind = 'page' AND title = 'Cutting rules'),
  'the snippet has the markdown removed');
SELECT is((SELECT url_hint FROM public.os_search('flamboyant marmalade') WHERE kind = 'page' AND title = 'Cutting rules'),
  '/knowledge/brain?section=Playbooks&page=os-cutting-rules', 'a page links to the Brain page');
SELECT is((SELECT count(*)::int FROM public.os_search('flamb marm') WHERE kind = 'page' AND title = 'Cutting rules'), 1,
  'word starts find the page while typing');
SELECT is((SELECT array_agg(DISTINCT kind ORDER BY kind) FROM public.os_search('quill')), ARRAY['client', 'task']::text[],
  'tasks and clients come back grouped by kind');
SELECT is((SELECT count(*)::int FROM public.os_search('quill') WHERE kind = 'task'), 3,
  'staff see every task that is not read-only, for every client');
SELECT is((SELECT count(*)::int FROM public.os_search('archived') WHERE kind = 'task'), 0,
  'read-only ClickUp history is left out');

-- ---------------------------------------------------------------- employee (12)
SELECT set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.os_search('Pelican handbook') WHERE kind = 'page'), 1, 'an employee finds pages');

-- ---------------------------------------------------------------- client (13-18)
SELECT set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.os_search('Pelican handbook') WHERE kind = 'page'), 0,
  'a client gets no pages even for an exact title');
SELECT is((SELECT count(*)::int FROM public.os_search('flamboyant marmalade')), 0, 'a client gets no pages for a body phrase');
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.os_search('quill') WHERE kind = 'task'),
  ARRAY['e1520000-0000-4000-8000-000000000001']::text[],
  'a client gets only their own client''s visible tasks, not another client''s, ClickUp calls or history');
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.os_search('quill') WHERE kind = 'client'), ARRAY['os-zephyr']::text[],
  'a client finds only their own client');
SELECT is((SELECT subtitle FROM public.os_search('launch hook') WHERE kind = 'task'), 'Zephyr Quill · Preparing Content',
  'a client sees the stage, not the internal status');

SELECT set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000004', true);
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.os_search('quill') WHERE kind = 'task'),
  ARRAY['e1520000-0000-4000-8000-000000000001']::text[],
  'a client linked by ad account only gets their own client''s tasks');

-- ---------------------------------------------------------------- no role, no sign-in, short (19-22)
SELECT set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000005', true);
SELECT is((SELECT count(*)::int FROM public.os_search('quill')), 0, 'a signed-in user with no role gets nothing');

SELECT set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.os_search('q')), 0, 'one letter returns nothing');
SELECT is((SELECT count(*)::int FROM public.os_search('quill', 1) WHERE kind = 'task'), 1, 'the limit applies per kind');

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is((SELECT count(*)::int FROM public.os_search('quill')), 0, 'no sign-in gets nothing');

SELECT * FROM finish();
ROLLBACK;
