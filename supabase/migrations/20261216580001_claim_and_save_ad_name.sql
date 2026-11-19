-- The Ad Name Generator saves every name it issues (audit plan item 5.8).
--
-- name_mappings gives each ad code its six tags, and the tag resolver reads it ahead of
-- the ad-name parser. Coda used to fill it and is gone; ClickUp has no ad code or tag
-- fields. Matthew decided the generator itself is the source.
--
-- claim_and_save_ad_name(account, name_tail, tags) checks the caller is staff and the
-- input is valid, spends the next code, and saves the full name, its client and its tags
-- in one transaction. Rejected input raises before the counter moves.

ALTER TABLE public.name_mappings
  ADD COLUMN IF NOT EXISTS ad_name text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'csv',
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.name_mappings DROP CONSTRAINT IF EXISTS name_mappings_source_check;
ALTER TABLE public.name_mappings
  ADD CONSTRAINT name_mappings_source_check CHECK (source IN ('csv', 'generator'));

COMMENT ON COLUMN public.name_mappings.ad_name IS
  'Full ad name as issued by the Ad Name Generator. Null for rows from a CSV upload or Coda.';
COMMENT ON COLUMN public.name_mappings.source IS
  'Where the row came from: csv (Settings upload or the old Coda sync) or generator.';

CREATE OR REPLACE FUNCTION public.claim_and_save_ad_name(
  p_account_id text,
  p_name_tail text,
  p_tags jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tags jsonb := coalesce(p_tags, '{}'::jsonb);
  v_key text;
  v_val text;
  v_value bigint;
  v_code text;
  v_name text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    OR public.has_role(auth.uid(), 'employee'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'only staff can claim an ad code'
      USING errcode = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ad_accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'unknown client account' USING errcode = '22023';
  END IF;

  -- Underscore-separated parts of letters and digits, without the code (the code is
  -- added here, after it is claimed).
  IF p_name_tail IS NULL
     OR p_name_tail !~ '^[A-Za-z0-9]+(_[A-Za-z0-9]+)*$'
     OR p_name_tail ~ '^GS[0-9]{6}(_|$)'
     OR length(p_name_tail) > 200 THEN
    RAISE EXCEPTION 'the ad name parts must be letters and digits separated by underscores, without a code'
      USING errcode = '22023';
  END IF;

  IF jsonb_typeof(v_tags) <> 'object' THEN
    RAISE EXCEPTION 'tags must be an object' USING errcode = '22023';
  END IF;
  FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(v_tags) LOOP
    IF v_key NOT IN ('ad_type', 'person', 'style', 'product', 'hook', 'theme') THEN
      RAISE EXCEPTION 'unknown tag %', v_key USING errcode = '22023';
    END IF;
    IF v_val IS NOT NULL AND (v_val !~ '^[A-Za-z0-9][A-Za-z0-9 &''/+.-]*$' OR length(v_val) > 100) THEN
      RAISE EXCEPTION 'tag % has characters that are not allowed', v_key USING errcode = '22023';
    END IF;
  END LOOP;

  UPDATE public.ad_name_counter
     SET value = value + 1,
         updated_at = now()
   WHERE id = 1
  RETURNING value INTO v_value;

  v_code := 'GS' || lpad(v_value::text, 6, '0');
  v_name := v_code || '_' || p_name_tail;

  INSERT INTO public.name_mappings
    (account_id, unique_code, ad_type, person, style, product, hook, theme, ad_name, source, created_by)
  VALUES
    (p_account_id, v_code,
     nullif(v_tags->>'ad_type', ''), nullif(v_tags->>'person', ''), nullif(v_tags->>'style', ''),
     nullif(v_tags->>'product', ''), nullif(v_tags->>'hook', ''), nullif(v_tags->>'theme', ''),
     v_name, 'generator', auth.uid());

  RETURN jsonb_build_object('code', v_value, 'unique_code', v_code, 'ad_name', v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_and_save_ad_name(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_and_save_ad_name(text, text, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_and_save_ad_name(text, text, jsonb) IS
  'Staff only. Spends the next ad code and saves the full name, client and six tags in name_mappings (source generator). Returns {code, unique_code, ad_name}.';
