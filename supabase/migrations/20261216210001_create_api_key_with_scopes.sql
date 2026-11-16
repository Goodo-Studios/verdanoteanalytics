-- create_api_key takes and checks scopes, and is staff only (audit plan item 1.5, step 1 of 3).
--
-- Today the screen calls create_api_key(key_name, api_key) and then writes the scopes with a
-- direct UPDATE on api_keys. The row rule "Users can manage own API keys" is FOR ALL with no
-- WITH CHECK, so any signed-in user (clients included, and anyone who signs up) can create a key
-- and give it any scope. Matthew decided API keys are staff only.
--
-- Step 1 (this migration): a three-argument create_api_key that refuses non-staff callers,
-- accepts only known scopes (read, write, sync) and stores them. The screen moves to it in the
-- same change, so it no longer writes the table directly.
-- Step 2: drop the two-argument create_api_key once the live frontend uses this one.
-- Step 3: replace the FOR ALL rule with owner SELECT and DELETE plus an is_active-only UPDATE.

CREATE OR REPLACE FUNCTION public.create_api_key(key_name text, api_key text, scopes text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(key_name, ''));
  v_scopes text[];
  v_id uuid;
BEGIN
  IF v_uid IS NULL
     OR NOT (public.has_role(auth.uid(), 'builder'::public.app_role)
             OR public.has_role(auth.uid(), 'employee'::public.app_role)) THEN
    RAISE EXCEPTION 'only staff can create API keys' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'give the key a name of 1 to 100 characters' USING ERRCODE = '22023';
  END IF;
  IF api_key IS NULL OR api_key !~ '^vdn_[0-9a-f]{24,}$' THEN
    RAISE EXCEPTION 'the key is not in the expected format' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT s ORDER BY s), '{}') INTO v_scopes
    FROM unnest(coalesce(scopes, '{}')) s;
  IF cardinality(v_scopes) = 0 THEN
    RAISE EXCEPTION 'choose at least one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_scopes <@ ARRAY['read', 'write', 'sync']) THEN
    RAISE EXCEPTION 'unknown scope' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, permissions)
  VALUES (v_uid, v_name, encode(extensions.digest(api_key, 'sha256'), 'hex'), substring(api_key FROM 1 FOR 8), v_scopes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_api_key(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_api_key(text, text, text[]) TO authenticated;
