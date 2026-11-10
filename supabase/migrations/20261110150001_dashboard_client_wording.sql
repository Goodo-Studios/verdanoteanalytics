-- Step 5a (old dashboard into Verdanote): drop the "synced from Coda" wording.
--
-- Coda was retired on 2026-10-09 and ClickUp replaced it. clients.origin keeps
-- its two values: 'manual' (added by hand) and 'coda', which is now a legacy
-- name for a client whose details the HQ sync keeps in step with its knowledge
-- file. The value is not renamed: the old dashboard's sync writers and the copy
-- script still send it, and the release re-points those writers here.
--
-- Only the two refusal messages change. Each function is rebuilt from its own
-- current definition with the one sentence replaced, so the body, owner,
-- SECURITY DEFINER setting and grants stay exactly as they are
-- (create or replace keeps grants). The block fails if the old text is not
-- found, so a later change to either function cannot be silently skipped.

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.set_client_details(text, text, text, date, date, text)'::regprocedure);
  v_new := replace(v_def,
    'This client is synced from Coda - change its service type, strategist, contract dates and status in the client knowledge file, not here.',
    'This client is kept in step with its knowledge file by the HQ sync - change its service type, strategist, contract dates and status in the knowledge file, not here.');
  if v_new = v_def and position('kept in step with its knowledge file' in v_def) = 0 then
    raise exception 'set_client_details: refusal message not found, migration needs updating';
  end if;
  execute v_new;

  v_def := pg_get_functiondef('public.update_client(text, text, boolean, boolean)'::regprocedure);
  v_new := replace(v_def,
    'This client is synced from Coda - change its name in the client knowledge file, not here.',
    'This client is kept in step with its knowledge file by the HQ sync - change its name in the knowledge file, not here.');
  if v_new = v_def and position('kept in step with its knowledge file' in v_def) = 0 then
    raise exception 'update_client: refusal message not found, migration needs updating';
  end if;
  execute v_new;
end;
$$;

comment on column public.clients.origin is
  'manual: added by hand in Verdanote. coda: legacy value (from before ClickUp replaced Coda) for a client the HQ sync keeps in step with its knowledge file; service type, strategist, contract dates, status and name are edited there.';
