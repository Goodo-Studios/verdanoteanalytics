-- US-001: client_highlights table + RLS
-- Per-account, per-period "This Period's Highlights" narrative with a
-- draft -> published lifecycle. Strategists (builder/employee) author draft_text
-- and promote it to published_text; clients ONLY ever read published_text of
-- published rows for accounts they belong to (via user_accounts membership).
--
-- RLS mirrors the established global pattern (see 20260518000001_fix_core_table_rls.sql):
--   - public.has_role(auth.uid(), '<role>'::public.app_role) for role checks
--   - account_id IN (SELECT public.get_user_account_ids(auth.uid())) for client membership
--
-- AC#3 (a client must NEVER read draft_text via any policy path):
-- The frontend queries Postgres as the `authenticated` role for BOTH builders and
-- clients (anon/publishable key + user JWT), so column GRANTs cannot distinguish
-- the two. Therefore clients are given NO direct SELECT policy on the base table —
-- the base-table policies grant access only to builder/employee. Client read access
-- flows exclusively through a SECURITY DEFINER view (client_highlights_published)
-- that returns only the published columns of published rows for the caller's linked
-- accounts. Because clients can never reach the base table, draft_text is unreadable
-- on every path; the view's projection physically omits the draft_text column.

-- ============================================================
-- Table
-- ============================================================

CREATE TABLE public.client_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  period TEXT NOT NULL,                       -- month key 'YYYY-MM'
  draft_text TEXT,
  published_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_highlights_period_format CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT client_highlights_account_period_unique UNIQUE (account_id, period)
);

CREATE INDEX idx_client_highlights_account_id ON public.client_highlights(account_id);
CREATE INDEX idx_client_highlights_account_period ON public.client_highlights(account_id, period);

CREATE TRIGGER update_client_highlights_updated_at
  BEFORE UPDATE ON public.client_highlights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS — builder/employee full access on the base table; NO client base-table
-- access (clients read only via the SECURITY DEFINER view below).
-- ============================================================

ALTER TABLE public.client_highlights ENABLE ROW LEVEL SECURITY;

-- Builder/employee: full read/write on draft + published for any account.
CREATE POLICY "Builder/employee can manage client_highlights" ON public.client_highlights
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  );

-- NOTE: intentionally NO "Client can view ..." policy on the base table.
-- With RLS enabled and no client-matching policy, the client role cannot SELECT
-- any row (and therefore cannot read draft_text) directly. Client reads go through
-- public.client_highlights_published.

-- ============================================================
-- Client read path: SECURITY DEFINER view exposing ONLY published columns of
-- published rows for the caller's linked accounts. Runs as the view owner so it
-- can read the base table while RLS blocks the client from touching it directly.
-- The membership check (get_user_account_ids) re-applies per-account scoping.
-- draft_text is physically absent from the projection.
-- ============================================================

CREATE VIEW public.client_highlights_published
  WITH (security_invoker = false)
  AS
  SELECT id, account_id, period, published_text, published_at, created_at, updated_at
  FROM public.client_highlights
  WHERE status = 'published'
    AND account_id IN (SELECT public.get_user_account_ids(auth.uid()));

-- Builders/employees query the base table directly; clients use the view.
GRANT SELECT ON public.client_highlights_published TO authenticated;

COMMENT ON TABLE public.client_highlights IS
  'Per-account, per-period highlights narrative. draft_text is strategist-only (builder/employee). Clients read published_text of published rows for their linked accounts via the client_highlights_published security-definer view only; they have no base-table RLS policy.';

COMMENT ON VIEW public.client_highlights_published IS
  'Client-facing read path for client_highlights. SECURITY DEFINER + get_user_account_ids membership filter; exposes only published columns of published rows. Never includes draft_text.';
