-- Client wall, check 3 of 3: a signed-in client reads every table in `public` and
-- sees only rows that belong to that client's own accounts.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- How it works
--   1. Two ad accounts, A (linked to the test client) and B (not linked), plus a test
--      client user, a test builder and an unrelated "other" user.
--   2. Every table in public gets two filler rows: one owned by the client (account A,
--      the client's user id) and one owned by someone else (account B, the other user
--      id). Filler values come from each column's type. Foreign keys and triggers are
--      switched off while seeding. A table whose filler row cannot be built (a check
--      constraint, an extension type) is counted as "not seeded", and the test fails if
--      too many are skipped, so the check cannot quietly go hollow.
--   3. The test acts as the `authenticated` role with the client's user id and counts,
--      table by table, the rows the client can read that belong to someone else:
--        * tables with an account_id column: rows whose account_id is another account
--        * tables with a user_id column: rows whose user_id is another user
--        * ad_accounts: rows whose id is another account
--        * tables with neither column: any readable row, except the allow-list below
--      A row with a NULL account_id or user_id counts as shared and is not flagged.
--   4. A staff control: the builder reads rows of account B, which proves the filler
--      rows exist and that the policies do let staff through.
--   5. A self-test: a new table with an open policy is flagged by the scan.
--
-- ALLOW-LIST for tables with neither column. Add a reason next to the name.
--   creative_type_menu: reference list of creative types, readable by everyone.

BEGIN;
SELECT plan(7);

CREATE TEMP TABLE wall_ids AS
SELECT 'wall_acct_a'::text AS acct_a,
       'wall_acct_b'::text AS acct_b,
       '00000000-0000-4000-8000-0000000000a1'::uuid AS client_id,
       '00000000-0000-4000-8000-0000000000b1'::uuid AS builder_id,
       '00000000-0000-4000-8000-0000000000c1'::uuid AS other_id;
GRANT SELECT ON wall_ids TO authenticated;

-- Filler SQL value for a column, chosen from its type. NULL when no filler fits.
CREATE FUNCTION pg_temp.filler(p_udt text, p_type text) RETURNS text AS $$
  SELECT CASE
    WHEN p_udt IN ('text', 'varchar', 'bpchar', 'citext', 'name') THEN 'gen_random_uuid()::text'
    WHEN p_udt = 'uuid' THEN 'gen_random_uuid()'
    WHEN p_udt IN ('int2', 'int4', 'int8', 'numeric', 'float4', 'float8') THEN 'floor(random() * 1000000000)'
    WHEN p_udt = 'bool' THEN 'false'
    WHEN p_udt IN ('jsonb', 'json') THEN quote_literal('{}') || '::' || p_udt
    WHEN p_udt IN ('timestamptz', 'timestamp') THEN 'now()'
    WHEN p_udt = 'date' THEN 'current_date'
    WHEN p_udt = 'time' OR p_udt = 'timetz' THEN 'localtime'
    WHEN p_type = 'ARRAY' THEN quote_literal('{}') || '::' || quote_ident(p_udt)
    WHEN p_type = 'USER-DEFINED' THEN
      (SELECT '(' || quote_literal(e.enumlabel) || '::' || quote_ident(t.typname) || ')'
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = p_udt ORDER BY e.enumsortorder LIMIT 1)
    ELSE NULL
  END
$$ LANGUAGE sql;

-- Filler values for columns with a check constraint that the type-based filler cannot
-- satisfy. Anything not listed here and not fillable is simply reported as not seeded.
CREATE FUNCTION pg_temp.override(p_table text, p_col text) RETURNS text AS $$
  SELECT CASE p_table || '.' || p_col
    WHEN 'report_schedules.cadence' THEN quote_literal('weekly')
    WHEN 'naming_convention_segments.dimension' THEN quote_literal('hook')
    WHEN 'naming_convention_vocab.dimension' THEN quote_literal('hook')
    WHEN 'client_highlights.period' THEN quote_literal('2026-01')
    WHEN 'media_assets.media_type' THEN quote_literal('image')
    WHEN 'client_task_decisions.decision' THEN quote_literal('approved')
    WHEN 'client_task_decisions.note' THEN 'NULL'
  END
$$ LANGUAGE sql;

-- Insert one filler row into a table, owned by (p_acct, p_user). Returns true on success.
CREATE FUNCTION pg_temp.seed_row(p_table text, p_acct text, p_user uuid) RETURNS boolean AS $$
DECLARE
  cols text[] := '{}';
  vals text[] := '{}';
  r record;
  v text;
BEGIN
  FOR r IN
    SELECT column_name, udt_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = p_table
       AND is_generated = 'NEVER' AND is_identity = 'NO'
     ORDER BY ordinal_position
  LOOP
    IF r.column_name = 'account_id' THEN
      cols := cols || quote_ident(r.column_name);
      vals := vals || (quote_literal(p_acct) || '::' || quote_ident(r.udt_name));
    ELSIF r.column_name = 'user_id' THEN
      cols := cols || quote_ident(r.column_name);
      vals := vals || (quote_literal(p_user::text) || '::uuid');
    ELSIF p_table = 'ad_accounts' AND r.column_name = 'id' THEN
      cols := cols || quote_ident(r.column_name);
      vals := vals || quote_literal(p_acct);
    ELSIF r.is_nullable = 'NO' AND r.column_default IS NULL THEN
      v := coalesce(pg_temp.override(p_table, r.column_name), pg_temp.filler(r.udt_name, r.data_type));
      IF v IS NULL THEN RETURN false; END IF;
      cols := cols || quote_ident(r.column_name);
      vals := vals || v;
    END IF;
  END LOOP;

  IF array_length(cols, 1) IS NULL THEN
    EXECUTE format('INSERT INTO public.%I DEFAULT VALUES', p_table);
  ELSE
    EXECUTE format('INSERT INTO public.%I (%s) VALUES (%s)', p_table, array_to_string(cols, ', '), array_to_string(vals, ', '));
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$$ LANGUAGE plpgsql;

-- Seed both filler rows for every table. Returns {seeded_other, seeded_own, tables}.
CREATE FUNCTION pg_temp.seed_all() RETURNS int[] AS $$
DECLARE
  t record;
  ids record;
  n_other int := 0;
  n_own int := 0;
  n_tables int := 0;
BEGIN
  SELECT * INTO ids FROM wall_ids;
  BEGIN
    SET LOCAL session_replication_role = replica;  -- no foreign key or trigger side effects
  EXCEPTION WHEN OTHERS THEN
    NULL;                                          -- not allowed here: seed with constraints on
  END;
  -- ad_accounts first so account foreign keys resolve even without replica mode.
  PERFORM pg_temp.seed_row('ad_accounts', ids.acct_a, ids.other_id);
  PERFORM pg_temp.seed_row('ad_accounts', ids.acct_b, ids.other_id);
  FOR t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'ad_accounts'
       AND c.relname NOT LIKE '\_\_wall\_probe%'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
     ORDER BY c.relname
  LOOP
    n_tables := n_tables + 1;
    IF pg_temp.seed_row(t.relname, ids.acct_b, ids.other_id) THEN n_other := n_other + 1; END IF;
    IF pg_temp.seed_row(t.relname, ids.acct_a, ids.client_id) THEN n_own := n_own + 1; END IF;
  END LOOP;
  RETURN ARRAY[n_other, n_own, n_tables + 1];
END
$$ LANGUAGE plpgsql;

-- Count rows visible to the current role that belong to someone else, per table.
-- Runs as `authenticated` with the given user id. Returns a text list of
-- "table (n rows)" for every table with a leak, plus visible counts for own rows.
CREATE FUNCTION pg_temp.scan(p_user uuid, p_acct text, p_allow text[]) RETURNS jsonb AS $$
DECLARE
  t record;
  tables text[] := '{}';
  hasacct boolean[] := '{}';
  hasuser boolean[] := '{}';
  i int;
  pred text;
  n bigint;
  leaks text[] := '{}';
  refused int := 0;
  readable int := 0;
  own_seen int := 0;
  own_n bigint;
BEGIN
  FOR t IN
    SELECT c.relname,
           EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'account_id') AS ha,
           EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'user_id') AS hu
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
     ORDER BY c.relname
  LOOP
    tables := tables || t.relname::text;
    hasacct := hasacct || t.ha;
    hasuser := hasuser || t.hu;
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  FOR i IN 1 .. array_length(tables, 1) LOOP
    BEGIN
      IF tables[i] = 'ad_accounts' THEN
        pred := format('id::text <> %L', p_acct);
      ELSIF hasacct[i] OR hasuser[i] THEN
        pred := concat_ws(' OR ',
          CASE WHEN hasacct[i] THEN format('(account_id IS NOT NULL AND account_id::text <> %L)', p_acct) END,
          CASE WHEN hasuser[i] THEN format('(user_id IS NOT NULL AND user_id <> %L::uuid)', p_user) END);
      ELSIF tables[i] IN ('naming_convention_segments', 'naming_convention_vocab') THEN
        -- Children of naming_conventions. Global conventions (account_id NULL) are
        -- readable by clients on purpose, so those rows are expected. A leak is a row
        -- whose parent convention the client cannot see (filler rows have random parents).
        pred := 'convention_id NOT IN (SELECT id FROM public.naming_conventions)';
      ELSIF tables[i] = ANY (p_allow) THEN
        CONTINUE;
      ELSE
        pred := 'true';
      END IF;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', tables[i], pred) INTO n;
      readable := readable + 1;
      IF n > 0 THEN leaks := leaks || (tables[i] || ' (' || n || ' rows)'); END IF;
      -- Own rows seen: proves the client can read something, so the scan is not vacuous.
      IF tables[i] = 'ad_accounts' THEN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE id::text = %L', tables[i], p_acct) INTO own_n;
      ELSIF hasacct[i] THEN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE account_id::text = %L', tables[i], p_acct) INTO own_n;
      ELSE
        own_n := 0;
      END IF;
      IF own_n > 0 THEN own_seen := own_seen + 1; END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      refused := refused + 1;      -- the role has no grant on the table: counts as blocked
    END;
  END LOOP;

  RESET ROLE;
  RETURN jsonb_build_object('leaks', to_jsonb(leaks), 'refused', refused, 'readable', readable, 'own_tables_seen', own_seen);
END
$$ LANGUAGE plpgsql;

-- ── Arrange ─────────────────────────────────────────────────────────────────
-- Seeding runs as the connecting (superuser) role; the scan switches role itself.
CREATE TEMP TABLE wall_seed AS SELECT pg_temp.seed_all() AS r;

-- The generic filler wrote a role and an account link for these users. Replace them
-- with the real ones: the client is a client of account A only, the builder is staff.
DELETE FROM public.user_roles    WHERE user_id IN (SELECT client_id FROM wall_ids UNION SELECT builder_id FROM wall_ids);
DELETE FROM public.user_accounts WHERE user_id IN (SELECT client_id FROM wall_ids UNION SELECT builder_id FROM wall_ids);
INSERT INTO public.user_roles (user_id, role)
SELECT client_id, 'client' FROM wall_ids;
INSERT INTO public.user_roles (user_id, role)
SELECT builder_id, 'builder' FROM wall_ids;
INSERT INTO public.user_accounts (user_id, account_id)
SELECT client_id, acct_a FROM wall_ids;

-- ── Assert ──────────────────────────────────────────────────────────────────
-- 1. The filler rows exist for most tables (so the scan below has teeth).
SELECT cmp_ok((SELECT r[1] FROM wall_seed), '>=', 60,
  'seeded filler rows owned by another account in at least 60 tables');
SELECT cmp_ok((SELECT r[2] FROM wall_seed), '>=', 60,
  'seeded filler rows owned by the client in at least 60 tables');

-- 2. The client sees no row that belongs to another account or user, in any table.
CREATE TEMP TABLE wall_client_scan AS
SELECT pg_temp.scan((SELECT client_id FROM wall_ids), (SELECT acct_a FROM wall_ids), ARRAY['creative_type_menu']) AS j;
SELECT is(
  (SELECT j->'leaks' FROM wall_client_scan),
  '[]'::jsonb,
  'client reads only rows of their own accounts in every table (leaks listed on failure)'
);
SELECT cmp_ok((SELECT (j->>'readable')::int FROM wall_client_scan), '>', 40,
  'the scan read more than 40 tables as the client');
SELECT cmp_ok((SELECT (j->>'own_tables_seen')::int FROM wall_client_scan), '>=', 5,
  'the client could read their own rows in at least 5 tables (the scan is not vacuous)');

-- 3. Staff control: a builder does see the other account's rows, so the policies let
--    staff through and the filler rows are really there.
CREATE TEMP TABLE wall_staff_scan AS
SELECT pg_temp.scan((SELECT builder_id FROM wall_ids), (SELECT acct_a FROM wall_ids), ARRAY['creative_type_menu']) AS j;
SELECT cmp_ok(jsonb_array_length((SELECT j->'leaks' FROM wall_staff_scan)), '>=', 20,
  'control: a builder reads rows of other accounts in at least 20 tables');

-- 4. Self-test: a new table that any signed-in user can read, holding another
--    account's row, is reported as a leak. This proves the scan catches the exact
--    mistake the wall exists for.
CREATE TABLE public.__wall_probe_leak (account_id text, user_id uuid);
ALTER TABLE public.__wall_probe_leak ENABLE ROW LEVEL SECURITY;
CREATE POLICY probe_open ON public.__wall_probe_leak FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.__wall_probe_leak TO authenticated;
INSERT INTO public.__wall_probe_leak SELECT acct_b, other_id FROM wall_ids;
CREATE TEMP TABLE wall_probe_scan AS
SELECT pg_temp.scan((SELECT client_id FROM wall_ids), (SELECT acct_a FROM wall_ids), ARRAY['creative_type_menu']) AS j;
SELECT matches(
  (SELECT (j->'leaks')::text FROM wall_probe_scan),
  '__wall_probe_leak',
  'self-test: an open table holding another account''s row is reported as a leak'
);

SELECT * FROM finish();
ROLLBACK;
