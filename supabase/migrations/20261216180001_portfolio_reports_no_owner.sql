-- Portfolio reports belong to no single client (audit plan item 1.3).
--
-- The reports function stored account_id = account_ids[0] on portfolio reports. A portfolio
-- report holds several clients' numbers, so the first client's login could read all of them
-- through the linked-accounts row rule. The function now stores null (the column allows it), and
-- this migration clears existing portfolio rows and adds a check so it cannot come back.
--
-- Staff list reports through the service role and are unaffected; the staff Reports page finds a
-- portfolio report under each of its accounts through portfolio_account_ids.

UPDATE public.reports SET account_id = NULL
 WHERE report_type = 'portfolio' AND account_id IS NOT NULL;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_portfolio_has_no_owner
  CHECK (report_type IS DISTINCT FROM 'portfolio' OR account_id IS NULL);
