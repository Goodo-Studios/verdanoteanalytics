-- C-2: Fix USING(true) RLS on core tables
-- The original migration (20260212023127) created permissive USING(true) policies
-- when this was a single-user app. This migration ensures proper role-aware policies
-- are in place across all six core tables, idempotently dropping any permissive
-- remnants and (re)creating the correct policies.

-- ============================================================
-- settings — not account-scoped; builder-only write, builder/employee read
-- ============================================================

DROP POLICY IF EXISTS "Allow all access to settings" ON public.settings;
DROP POLICY IF EXISTS "Builder can manage settings" ON public.settings;
DROP POLICY IF EXISTS "Builder/employee can read settings" ON public.settings;

CREATE POLICY "Builder can manage settings" ON public.settings
  FOR ALL
  USING (public.has_role(auth.uid(), 'builder'::public.app_role));

CREATE POLICY "Employee can read settings" ON public.settings
  FOR SELECT
  USING (public.has_role(auth.uid(), 'employee'::public.app_role));

-- ============================================================
-- ad_accounts — account-scoped
-- ============================================================

DROP POLICY IF EXISTS "Allow all access to ad_accounts" ON public.ad_accounts;
DROP POLICY IF EXISTS "Builder/employee can manage accounts" ON public.ad_accounts;
DROP POLICY IF EXISTS "Client can view linked accounts" ON public.ad_accounts;

CREATE POLICY "Builder/employee can manage accounts" ON public.ad_accounts
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view linked accounts" ON public.ad_accounts
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND id IN (SELECT public.get_user_account_ids(auth.uid()))
  );

-- ============================================================
-- creatives — account-scoped
-- ============================================================

DROP POLICY IF EXISTS "Allow all access to creatives" ON public.creatives;
DROP POLICY IF EXISTS "Builder/employee can manage creatives" ON public.creatives;
DROP POLICY IF EXISTS "Client can view linked creatives" ON public.creatives;

CREATE POLICY "Builder/employee can manage creatives" ON public.creatives
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view linked creatives" ON public.creatives
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND account_id IN (SELECT public.get_user_account_ids(auth.uid()))
  );

-- ============================================================
-- name_mappings — account-scoped
-- ============================================================

DROP POLICY IF EXISTS "Allow all access to name_mappings" ON public.name_mappings;
DROP POLICY IF EXISTS "Builder/employee can manage name_mappings" ON public.name_mappings;
DROP POLICY IF EXISTS "Client can view linked name_mappings" ON public.name_mappings;

CREATE POLICY "Builder/employee can manage name_mappings" ON public.name_mappings
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view linked name_mappings" ON public.name_mappings
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND account_id IN (SELECT public.get_user_account_ids(auth.uid()))
  );

-- ============================================================
-- sync_logs — account-scoped
-- ============================================================

DROP POLICY IF EXISTS "Allow all access to sync_logs" ON public.sync_logs;
DROP POLICY IF EXISTS "Builder/employee can manage sync_logs" ON public.sync_logs;
DROP POLICY IF EXISTS "Client can view linked sync_logs" ON public.sync_logs;

CREATE POLICY "Builder/employee can manage sync_logs" ON public.sync_logs
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view linked sync_logs" ON public.sync_logs
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND account_id IN (SELECT public.get_user_account_ids(auth.uid()))
  );

-- ============================================================
-- reports — account-scoped; clients read-only for linked accounts.
-- Note: earlier migrations added "All authenticated users can view reports"
-- and a public-share policy. Those are dropped and replaced with stricter
-- account-scoped client access. The is_public sharing column is preserved:
-- unauthenticated users can still reach explicitly shared reports.
-- ============================================================

DROP POLICY IF EXISTS "Allow all access to reports" ON public.reports;
DROP POLICY IF EXISTS "Builder/employee can manage reports" ON public.reports;
DROP POLICY IF EXISTS "Client can view linked reports" ON public.reports;
DROP POLICY IF EXISTS "All authenticated users can view reports" ON public.reports;
DROP POLICY IF EXISTS "Public can view shared reports" ON public.reports;

CREATE POLICY "Builder/employee can manage reports" ON public.reports
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view linked reports" ON public.reports
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND account_id IN (SELECT public.get_user_account_ids(auth.uid()))
  );

-- Preserve public sharing: unauthenticated access only for is_public=true rows
CREATE POLICY "Public can view shared reports" ON public.reports
  FOR SELECT
  USING (is_public = true);
