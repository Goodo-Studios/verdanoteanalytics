-- API key rows: owners list, revoke and delete, nothing else (audit plan 1.5 steps 2 and 3).
--
-- Step 1 (live since 2026-11-16) made create_api_key(text, text, text[]) staff only with checked
-- scopes, and the screen no longer writes api_keys except to revoke (is_active = false) or delete.
-- This drops the old two-argument create_api_key (any signed-in user, no scope check) and replaces
-- the FOR ALL owner rule, which let an owner rewrite a key's scopes with a direct update.

DROP FUNCTION IF EXISTS public.create_api_key(text, text);

DROP POLICY IF EXISTS "Users can manage own API keys" ON public.api_keys;

CREATE POLICY api_keys_owner_select ON public.api_keys
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY api_keys_owner_delete ON public.api_keys
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Revoke only: the row must stay the owner's and end up switched off.
CREATE POLICY api_keys_owner_revoke ON public.api_keys
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND is_active = false);

-- Signed-in users may change no column but is_active, and never insert directly
-- (create_api_key is SECURITY DEFINER and inserts as its owner).
REVOKE INSERT, UPDATE ON public.api_keys FROM authenticated, anon;
GRANT UPDATE (is_active) ON public.api_keys TO authenticated;
