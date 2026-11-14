-- The staff policy on pipeline_tasks (20261109000001) had no TO clause, so it applied to every
-- role including anon. A signed-out request then ran has_role(auth.uid(), ...) and errored instead of
-- getting no rows. Limit it to authenticated. The client read policy already says TO authenticated
-- (20261109000007).
--
-- ALTER POLICY changes only the role list and leaves the USING and WITH CHECK expressions as they
-- are, and it can run again with no effect. clickup_client_folders was dropped by 20261109000007, so
-- it has nothing to fix; the block skips quietly when the table or policy is missing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'pipeline_tasks'
       AND policyname = 'Builder/employee can manage pipeline_tasks'
  ) THEN
    ALTER POLICY "Builder/employee can manage pipeline_tasks" ON public.pipeline_tasks TO authenticated;
  END IF;
END
$$;
