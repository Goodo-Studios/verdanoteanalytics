-- Existing cron jobs build their function address with public.edge_function_url
-- (audit Batch 9, cron URL step 2).
--
-- 16 production cron jobs call 'https://<ref>.supabase.co/functions/v1/<name>' as a quoted literal.
-- move_cron_jobs_to_edge_function_url() replaces that literal with edge_function_url('<name>'),
-- but only when edge_function_url gives back exactly the address the job had, so no job starts
-- calling another project. With no project URL in the vault (local test databases) it moves
-- nothing. Staging runs no cron jobs (scripts/staging-lockdown.sql). Safe to run twice.

CREATE OR REPLACE FUNCTION public.move_cron_jobs_to_edge_function_url()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  j record;
  v_old_url text;
  v_name text;
  v_new_url text;
  v_command text;
  v_moved integer := 0;
BEGIN
  FOR j IN
    SELECT jobid, jobname, command
      FROM cron.job
     WHERE command ~ '''https://[a-z0-9]+\.supabase\.co/functions/v1/[a-z0-9][a-z0-9_-]*'''
  LOOP
    v_old_url := substring(j.command FROM 'https://[a-z0-9]+\.supabase\.co/functions/v1/[a-z0-9][a-z0-9_-]*');
    v_name := substring(v_old_url FROM '/functions/v1/([a-z0-9][a-z0-9_-]*)$');
    BEGIN
      v_new_url := public.edge_function_url(v_name);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'cron job %: no project URL in the vault, left as it is', j.jobname;
      CONTINUE;
    END;
    IF v_new_url IS DISTINCT FROM v_old_url THEN
      RAISE NOTICE 'cron job %: calls another host, left as it is', j.jobname;
      CONTINUE;
    END IF;
    v_command := replace(j.command, '''' || v_old_url || '''', 'public.edge_function_url(''' || v_name || ''')');
    IF v_command = j.command THEN
      CONTINUE;
    END IF;
    PERFORM cron.alter_job(j.jobid, command := v_command);
    v_moved := v_moved + 1;
  END LOOP;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.move_cron_jobs_to_edge_function_url() FROM PUBLIC, anon, authenticated;

SELECT public.move_cron_jobs_to_edge_function_url();
