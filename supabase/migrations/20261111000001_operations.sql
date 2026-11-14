-- Goodo OS wave D: operations page for the job queue (consolidation step 4d). Port of
-- the Goodo OS operator recovery page (src/pages/staff/Operations.tsx,
-- backend/services/operatorRecovery.ts, backend/routes/operations.ts, migration
-- 057_job_manual_resolution.sql).
--
-- The queue itself (durable_jobs, job_audit) and two of the three operator commands
-- came with step 3 (migration 20261109000005): replay_job puts a job in recovery back
-- in the queue and resolve_job_manually closes it after a manual check. This adds the
-- third Goodo OS command:
--
--   cancel_queued_job   a builder or employee cancels a queued job that has never been
--                       claimed, with a reason. A job that was ever claimed (including a
--                       replayed one, whose earlier attempt may have reached the outside
--                       service) is refused, so a cancellation never hides an effect that
--                       may have happened. A job in recovery is closed with
--                       resolve_job_manually instead.
--
-- No new table. Staff read durable_jobs and job_audit under the step 3 row rules;
-- clients read neither. The page reads the job columns it needs, never the payload.
-- Tests: supabase/tests/operations_test.sql.

create or replace function public.cancel_queued_job(p_job_id uuid, p_reason text)
returns public.durable_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.durable_jobs;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can cancel a job' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 then
    raise exception 'reason must be 10 to 500 characters' using errcode = '22023';
  end if;
  select * into v_job from public.durable_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if v_job.state <> 'queued' or v_job.attempts <> 0 or v_job.send_started_fence is not null
     or exists (select 1 from public.job_audit a
                 where a.job_id = v_job.id and a.action in ('claimed', 'send_started', 'retry', 'recovery', 'manual_replay')) then
    raise exception 'only a queued job that has never been claimed can be canceled' using errcode = '55000';
  end if;
  update public.durable_jobs
     set state = 'canceled', last_error = left('canceled by staff: ' || btrim(p_reason), 1000), lease_owner = null, lease_until = null
   where id = v_job.id
   returning * into v_job;
  perform public.job_audit_write(v_job.id, v_job.fence, 'manual_cancel', coalesce(auth.uid()::text, 'unknown'),
    jsonb_build_object('reason', btrim(p_reason)));
  return v_job;
end;
$$;

revoke all on function public.cancel_queued_job(uuid, text) from public, anon;
grant execute on function public.cancel_queued_job(uuid, text) to authenticated, service_role;

comment on function public.cancel_queued_job(uuid, text) is
  'Staff cancel a queued job that was never claimed, with a reason (port of the Goodo OS operations cancel command).';
