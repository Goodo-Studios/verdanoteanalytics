-- US-001 (Phase C, Feature #5): Postgres schema for customer reviews +
-- voice-of-customer angle clusters.
--
-- PURPOSE
-- Net-new durable storage for (a) raw ingested customer reviews and (b) the
-- extracted voice-of-customer angle clusters. No review/VOC storage exists today.
-- These tables live in the system of record (Verdanote/Postgres) and feed both
-- the #4 brief synthesizer (angle_clusters is shaped for direct consumption) and
-- the creative strategist.
--
-- DATA FLOW (v1): operator-supplied reviews CSV -> HQ LLM extraction (VOC +
-- clustering) -> US-002 service-role ingest edge function -> these tables.
-- All LLM work stays in HQ; the edge function is a thin service-role persister.
--
-- RLS: account-scoped, matching the established Verdanote RBAC pattern used by
-- creatives / name_mappings (see 20260518000001_fix_core_table_rls.sql):
--   * builder/employee can manage (FOR ALL)
--   * client can view rows for accounts they are linked to (FOR SELECT, scoped
--     via public.get_user_account_ids(auth.uid()))
-- service_role (the US-002 ingest path) bypasses RLS, consistent with the other
-- service-role write paths in this codebase.
--
-- IDEMPOTENT: tables use IF NOT EXISTS; indexes use IF NOT EXISTS; policies use
-- DROP POLICY IF EXISTS before CREATE POLICY.

-- ============================================================
-- customer_reviews — raw ingested review rows (one row per source review)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.customer_reviews (
  id                UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  -- Where the review came from (e.g. 'amazon', 'trustpilot', 'site', 'csv').
  source            TEXT,
  -- Source URL or external identifier for the review, when available.
  source_url        TEXT,
  source_identifier TEXT,
  review_text       TEXT,
  rating            NUMERIC,
  author            TEXT,
  reviewed_at       TIMESTAMPTZ,
  -- Full original row as ingested (tolerant CSV mapping keeps the raw payload).
  raw               JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_reviews_account_id_idx
  ON public.customer_reviews (account_id);

-- ============================================================
-- angle_clusters — extracted voice-of-customer angle clusters.
-- Shaped for direct consumption by the #4 brief synthesizer + the strategist.
-- pains/desires/objections/customer_language are text[] of mined signals.
-- supporting_review_ids references the customer_reviews rows backing the cluster.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.angle_clusters (
  id                    UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id            TEXT NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  label                 TEXT,
  summary               TEXT,
  -- Theme / category bucket for the angle (e.g. 'value', 'efficacy', 'price').
  theme                 TEXT,
  pains                 TEXT[] NOT NULL DEFAULT '{}',
  desires               TEXT[] NOT NULL DEFAULT '{}',
  objections            TEXT[] NOT NULL DEFAULT '{}',
  customer_language     TEXT[] NOT NULL DEFAULT '{}',
  -- Reviews backing this cluster (soft references into customer_reviews.id).
  supporting_review_ids UUID[] NOT NULL DEFAULT '{}',
  -- Model confidence / ranking score for the cluster, when produced.
  score                 NUMERIC,
  source                TEXT NOT NULL DEFAULT 'csv',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS angle_clusters_account_id_idx
  ON public.angle_clusters (account_id);

-- ============================================================
-- RLS — account-scoped, matching the established pattern from
-- 20260518000001_fix_core_table_rls.sql (creatives / name_mappings):
--   builder/employee manage; client views rows for their linked accounts.
-- service_role bypasses RLS (US-002 ingest path).
-- ============================================================

ALTER TABLE public.customer_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.angle_clusters   ENABLE ROW LEVEL SECURITY;

-- customer_reviews -----------------------------------------------------------
DROP POLICY IF EXISTS "Builder/employee can manage customer_reviews" ON public.customer_reviews;
DROP POLICY IF EXISTS "Client can view linked customer_reviews" ON public.customer_reviews;

CREATE POLICY "Builder/employee can manage customer_reviews" ON public.customer_reviews
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view linked customer_reviews" ON public.customer_reviews
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND account_id IN (SELECT public.get_user_account_ids(auth.uid()))
  );

-- angle_clusters -------------------------------------------------------------
DROP POLICY IF EXISTS "Builder/employee can manage angle_clusters" ON public.angle_clusters;
DROP POLICY IF EXISTS "Client can view linked angle_clusters" ON public.angle_clusters;

CREATE POLICY "Builder/employee can manage angle_clusters" ON public.angle_clusters
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

CREATE POLICY "Client can view linked angle_clusters" ON public.angle_clusters
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'client'::public.app_role)
    AND account_id IN (SELECT public.get_user_account_ids(auth.uid()))
  );
