-- Per-person dismissals for suggestion rows in the staff pages (first user: the staff list
-- check on Admin > Team and settings). Additive: one new table, nothing existing is changed.
--
-- A row means "this person hid this suggestion". Deleting the row brings the suggestion back.
-- item_key identifies the suggestion (for the staff list check: the email plus its issue list,
-- so a new issue on the same person shows up again). Each person sees and changes only their
-- own rows; non-staff logins have no access.

CREATE TABLE IF NOT EXISTS public.dismissed_suggestions (
  user_id      uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  surface      text        NOT NULL CHECK (char_length(surface) BETWEEN 1 AND 80),
  item_key     text        NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 300),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surface, item_key)
);

ALTER TABLE public.dismissed_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dismissed_suggestions_select ON public.dismissed_suggestions;
CREATE POLICY dismissed_suggestions_select ON public.dismissed_suggestions
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );

DROP POLICY IF EXISTS dismissed_suggestions_insert ON public.dismissed_suggestions;
CREATE POLICY dismissed_suggestions_insert ON public.dismissed_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );

DROP POLICY IF EXISTS dismissed_suggestions_delete ON public.dismissed_suggestions;
CREATE POLICY dismissed_suggestions_delete ON public.dismissed_suggestions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.dismissed_suggestions FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.dismissed_suggestions TO authenticated;

COMMENT ON TABLE public.dismissed_suggestions IS
  'Suggestions a staff member hid, per person. Delete the row to show the suggestion again.';
