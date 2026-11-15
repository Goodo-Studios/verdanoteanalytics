-- RLS initPlan rewrite.
--
-- Postgres evaluates auth.uid(), auth.role() and has_role(auth.uid(), ...) once per
-- ROW when they appear bare in a policy. Written as (select ...) the planner turns
-- them into an initPlan that runs once per STATEMENT. On large tables that is the
-- difference between one role lookup and one per scanned row.
--
-- What this does
--   * Walks every policy in the public schema (read from pg_policy, so nothing is
--     missed and nothing is hard-coded) and rewrites its USING and WITH CHECK text:
--         has_role(auth.uid(), '<role>'::app_role)  ->  (select has_role((select auth.uid()), '<role>'::app_role))
--         auth.uid() / auth.role() / auth.jwt()     ->  (select auth.uid()) etc.
--   * Uses ALTER POLICY, which keeps the policy's name, command, PERMISSIVE flag and
--     role list and swaps the expressions in place. There is no window in which a
--     table has no policy, so there is no moment of denied or widened access.
--   * Only the expression text changes. Each wrapped call returns exactly what the
--     bare call returned inside one statement (auth.uid() and has_role() are STABLE:
--     the JWT claims and user_roles do not change mid-statement), so who can see
--     which rows is identical.
--
-- Idempotent: expressions that are already wrapped are skipped (the lookbehind
-- ignores any call that is directly preceded by "select "), so a second run changes
-- nothing and reports 0. The final check raises if any bare call is left in public.
--
-- Not changed on purpose
--   * public.has_role and public.get_user_account_ids are already STABLE
--     SECURITY DEFINER SQL functions with a fixed search_path, so there is nothing
--     to mark. Their bodies are left alone.
--   * No indexes. user_roles has a unique index on (user_id, role) and user_accounts
--     one on (user_id, account_id), which are the only lookups the helpers do.
--   * Policies outside the public schema (storage.*): this migration role does not
--     own them.

DO $rls$
DECLARE
  pol record;
  v_search_path text := current_setting('search_path');
  new_qual text;
  new_check text;
  stmt text;
  changed int := 0;
  leftover int;

  -- Wrap a policy expression. Order matters: has_role(...) first, while its inner
  -- auth.uid() is still bare, then every remaining bare auth call.
  -- (?<!select ) with the 'i' flag skips calls that are already wrapped, in either
  -- the deparsed form "( SELECT auth.uid() AS uid)" or our own "(select auth.uid())".
BEGIN
  -- Make the deparsed text resolve the same way it was written.
  PERFORM set_config('search_path', 'public, pg_catalog', true);

  FOR pol IN
    SELECT p.polname,
           c.relname,
           pg_get_expr(p.polqual, p.polrelid)      AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS wcheck
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
     ORDER BY c.relname, p.polname
  LOOP
    new_qual := pol.qual;
    new_check := pol.wcheck;

    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual,
        '(?<!select )(?:public\.)?has_role\(auth\.uid\(\), (''[a-z_]+''::(?:public\.)?app_role)\)',
        '(select has_role((select auth.uid()), \1))', 'ig');
      new_qual := regexp_replace(new_qual,
        '(?<!select )auth\.(uid|role|jwt)\(\)',
        '(select auth.\1())', 'ig');
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check,
        '(?<!select )(?:public\.)?has_role\(auth\.uid\(\), (''[a-z_]+''::(?:public\.)?app_role)\)',
        '(select has_role((select auth.uid()), \1))', 'ig');
      new_check := regexp_replace(new_check,
        '(?<!select )auth\.(uid|role|jwt)\(\)',
        '(select auth.\1())', 'ig');
    END IF;

    IF new_qual IS NOT DISTINCT FROM pol.qual AND new_check IS NOT DISTINCT FROM pol.wcheck THEN
      CONTINUE;
    END IF;

    stmt := format('ALTER POLICY %I ON public.%I', pol.polname, pol.relname);
    IF new_qual IS NOT NULL THEN
      stmt := stmt || ' USING (' || new_qual || ')';
    END IF;
    IF new_check IS NOT NULL THEN
      stmt := stmt || ' WITH CHECK (' || new_check || ')';
    END IF;
    EXECUTE stmt;
    changed := changed + 1;
  END LOOP;

  PERFORM set_config('search_path', v_search_path, true);

  -- Self-check: no bare auth call may remain in any public policy.
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(?<!select )auth\.(uid|role|jwt)\(\)';
  IF leftover > 0 THEN
    RAISE EXCEPTION 'rls_initplan: % public polic(ies) still call auth.* unwrapped', leftover;
  END IF;

  RAISE NOTICE 'rls_initplan: rewrote % polic(ies)', changed;
END
$rls$;
