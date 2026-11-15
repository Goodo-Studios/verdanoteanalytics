-- Vault: staff read and manage every item (audit plan item 1.6, step 1 of 3).
--
-- Matthew's rule: staff can read and manage all Vault items; non-staff have no Vault access.
--
-- Before this migration the rules disagreed. The item read rule let staff see a teammate's item
-- (staff or saved_by), but vault_visible_item_ids(), which guards transcripts, frameworks, tags,
-- embeddings and match_items, returned only the caller's own items (user_id), and item update and
-- delete were owner only. A teammate's item therefore opened with no transcript or analysis,
-- search skipped it, re-analyze failed, and edits and deletes changed nothing.
--
-- Step 1 (this migration, widens access for staff only):
--   1. Fill saved_by from user_id where it is empty, and keep it filled on insert.
--   2. Split each child FOR ALL rule into separate read, insert, update and delete rules with the
--      same condition, so the helper change below cannot widen anything by accident later.
--   3. vault_visible_item_ids() returns every item for staff; non-staff still get their own.
--   4. Staff may update and delete any item.
-- Step 2: column grants so only functions change file_path, thumbnail_url, saved_by and user_id.
-- Step 3: remove non-staff access (owner rules and the helper's own-items branch).

-- 1. saved_by ---------------------------------------------------------------------------------
UPDATE public.inspiration_items SET saved_by = user_id WHERE saved_by IS NULL;

CREATE OR REPLACE FUNCTION public.inspiration_items_fill_saved_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.saved_by IS NULL THEN
    NEW.saved_by := NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.inspiration_items_fill_saved_by() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS inspiration_items_fill_saved_by ON public.inspiration_items;
CREATE TRIGGER inspiration_items_fill_saved_by
  BEFORE INSERT ON public.inspiration_items
  FOR EACH ROW EXECUTE FUNCTION public.inspiration_items_fill_saved_by();

-- 2. split the child FOR ALL rules -------------------------------------------------------------
DO $split$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inspiration_transcripts', 'inspiration_frameworks', 'inspiration_tags'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                      USING (item_id IN (SELECT public.vault_visible_item_ids()))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
                      WITH CHECK (item_id IN (SELECT public.vault_visible_item_ids()))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
                      USING (item_id IN (SELECT public.vault_visible_item_ids()))
                      WITH CHECK (item_id IN (SELECT public.vault_visible_item_ids()))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
                      USING (item_id IN (SELECT public.vault_visible_item_ids()))', t || '_delete', t);
  END LOOP;
END
$split$;

-- 3. the helper ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vault_visible_item_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT i.id FROM public.inspiration_items i
   WHERE (SELECT public.has_role(auth.uid(), 'builder'::public.app_role))
      OR (SELECT public.has_role(auth.uid(), 'employee'::public.app_role))
      OR i.user_id = auth.uid()
$$;

-- 4. staff update and delete any item --------------------------------------------------------
DROP POLICY IF EXISTS "inspiration_items_staff_update" ON public.inspiration_items;
CREATE POLICY "inspiration_items_staff_update" ON public.inspiration_items
  FOR UPDATE TO authenticated
  USING ((SELECT has_role((SELECT auth.uid()), 'builder'::app_role))
         OR (SELECT has_role((SELECT auth.uid()), 'employee'::app_role)))
  WITH CHECK ((SELECT has_role((SELECT auth.uid()), 'builder'::app_role))
              OR (SELECT has_role((SELECT auth.uid()), 'employee'::app_role)));

DROP POLICY IF EXISTS "inspiration_items_staff_delete" ON public.inspiration_items;
CREATE POLICY "inspiration_items_staff_delete" ON public.inspiration_items
  FOR DELETE TO authenticated
  USING ((SELECT has_role((SELECT auth.uid()), 'builder'::app_role))
         OR (SELECT has_role((SELECT auth.uid()), 'employee'::app_role)));
