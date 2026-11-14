-- Client progress feed accepts hand-made clients.
--
-- Owner decision, 2026-11-11: clients.origin = 'manual' clients are accepted by the progress feed.
-- apply_client_progress (20261116000001) refused them with reason 'manual_client'. This replaces the
-- function with that refusal removed and nothing else changed: same signature, SECURITY DEFINER,
-- search_path, row lock on the client, unknown_client refusal, field handling, audit and grants.
-- The grants are restated below because create or replace keeps them, and this makes the file
-- self-contained. origin is still never written by the function.

create or replace function public.apply_client_progress(
  p_token_id uuid,
  p_source text,
  p_items jsonb,
  p_request_bytes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_d jsonb;
  v_slug text;
  v_origin text;
  v_received integer := 0;
  v_applied integer := 0;
  v_deliverables integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_outcome text;
begin
  -- A token revoked between the function's check and this call is refused here too.
  if not exists (select 1 from public.ingest_tokens where id = p_token_id and revoked_at is null) then
    raise exception 'token is not active' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_received := v_received + 1;
    v_slug := v_item ->> 'slug';
    select c.origin into v_origin from public.clients c where c.slug = v_slug for update;
    if not found then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('slug', v_slug, 'reason', 'unknown_client'));
      continue;
    end if;

    update public.clients c set
      name = case when v_item ? 'name' then v_item ->> 'name' else c.name end,
      status = case when v_item ? 'status' then v_item ->> 'status' else c.status end,
      service_type = case when v_item ? 'service_type' then v_item ->> 'service_type' else c.service_type end,
      strategist = case when v_item ? 'strategist' then v_item ->> 'strategist' else c.strategist end,
      pct_complete = case when v_item ? 'pct_complete' then (v_item ->> 'pct_complete')::integer else c.pct_complete end,
      contract_start = case when v_item ? 'contract_start' then (v_item ->> 'contract_start')::date else c.contract_start end,
      contract_end = case when v_item ? 'contract_end' then (v_item ->> 'contract_end')::date else c.contract_end end,
      month = case when v_item ? 'month' then v_item ->> 'month' else c.month end,
      notes = case when v_item ? 'notes' then v_item ->> 'notes' else c.notes end,
      last_synced = now(),
      updated_at = now()
    where c.slug = v_slug;

    for v_d in select value from jsonb_array_elements(coalesce(v_item -> 'deliverables', '[]'::jsonb)) loop
      insert into public.deliverables (client_slug, month, type, status, file_path)
      values (v_slug, v_d ->> 'month', v_d ->> 'type', v_d ->> 'status', v_d ->> 'file_path')
      on conflict (client_slug, month, type) do update set
        status = excluded.status,
        file_path = case when v_d ? 'file_path' then excluded.file_path else public.deliverables.file_path end,
        updated_at = now();
      v_deliverables := v_deliverables + 1;
    end loop;

    v_applied := v_applied + 1;
  end loop;

  v_outcome := case
    when v_received = 0 or jsonb_array_length(v_rejected) = 0 then 'ok'
    when v_applied = 0 then 'rejected'
    else 'partial'
  end;

  update public.ingest_tokens set last_used_at = now() where id = p_token_id;
  insert into public.ingest_audit
    (token_id, source, outcome, client_count, applied_count, rejected_count, deliverable_count, request_bytes, rejected)
  values
    (p_token_id, left(p_source, 60), v_outcome, v_received, v_applied, jsonb_array_length(v_rejected), v_deliverables, p_request_bytes, v_rejected);
  -- Keep the audit to about half a year.
  delete from public.ingest_audit where called_at < now() - interval '180 days';

  return jsonb_build_object(
    'received', v_received,
    'applied', v_applied,
    'rejected', v_rejected,
    'deliverables_upserted', v_deliverables,
    'recorded_at', now()
  );
end;
$$;

revoke all on function public.apply_client_progress(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.apply_client_progress(uuid, text, jsonb, integer) to service_role;
