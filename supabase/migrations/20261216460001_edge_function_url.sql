-- Audit Batch 9: edge function addresses for cron jobs come from a setting, not a hard-coded host.
--
-- 34 cron migrations call the production functions host directly, so on staging those jobs point
-- at production until scripts/staging-lockdown.sql removes them. New cron jobs build the address
-- with this helper instead:
--   url := public.edge_function_url('sync')
-- It reads the project URL from the vault: project_url first, else storage_signing_project_url
-- (production already has the second, checked 2026-11-16). With neither set it raises instead of
-- guessing a host. Moving the existing jobs over is a separate production change.

CREATE OR REPLACE FUNCTION public.edge_function_url(p_function text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base text;
BEGIN
  IF p_function IS NULL OR p_function !~ '^[a-z0-9][a-z0-9_-]*$' THEN
    RAISE EXCEPTION 'edge_function_url: % is not a plain function name', p_function
      USING ERRCODE = '22023';
  END IF;

  SELECT s.decrypted_secret INTO v_base
    FROM vault.decrypted_secrets s
   WHERE s.name = 'project_url';
  IF v_base IS NULL OR btrim(v_base) = '' THEN
    SELECT s.decrypted_secret INTO v_base
      FROM vault.decrypted_secrets s
     WHERE s.name = 'storage_signing_project_url';
  END IF;
  IF v_base IS NULL OR btrim(v_base) = '' THEN
    RAISE EXCEPTION 'edge_function_url: no project_url or storage_signing_project_url in the vault';
  END IF;

  RETURN rtrim(btrim(v_base), '/') || '/functions/v1/' || p_function;
END;
$$;

REVOKE ALL ON FUNCTION public.edge_function_url(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edge_function_url(text) TO service_role;
