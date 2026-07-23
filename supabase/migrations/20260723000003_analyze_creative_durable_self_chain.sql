-- =============================================================================
-- Creative Intelligence (WS1) — durable self-chain for the analyze-creative drain
-- =============================================================================
-- Idempotent (CREATE OR REPLACE + REVOKE). Manual `supabase db push`.
-- Numbered off the remote frontier (last applied: 20260723000002).
--
-- WHY: after the orphan-recovery fix (20260723000002) the drain still sustained
-- only ~200/hr on the video backlog. Measurement showed it was not the per-item
-- throughput (a driven back-to-back loop hit ~2,000/hr) but the CONTINUATION: the
-- edge function self-chained the next invocation with a fire-and-forget
-- `fetch()` fired AFTER the handler returned its Response. The Supabase edge
-- isolate is frozen once the Response is returned, so that outbound request is
-- best-effort and was usually cancelled before being sent — the chain died after
-- a single hop. The drain then only advanced one bounded batch per 2-min cron
-- tick, and single-flight blocked the intervening ticks while the last batch's
-- rows were still fresh 'analyzing' → multi-minute stalls between bursts.
--
-- FIX: enqueue the next invocation the SAME way the cron does — a DB-backed
-- pg_net request. pg_net persists the request in a queue that a Postgres
-- background worker sends independently of the edge isolate lifecycle, so the
-- chain reliably continues back-to-back. This preserves single-flight (the child
-- is chain=depth+1 and skips the chain=0 guard) and the $/account cap + MAX_CHAIN
-- still bound it. Mirrors the cron idiom exactly (hardcoded function URL +
-- service-role bearer from vault.decrypted_secrets).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

create or replace function public.poke_analyze_creative(p_body jsonb)
returns bigint
language sql
security definer
set search_path = public, extensions, net
as $$
  select net.http_post(
    url                  := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/analyze-creative',
    body                 := p_body,
    headers              := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    -- Hold the connection long enough for the child's ~45s batch to return a
    -- clean 200 (cosmetic — the child survives a disconnect anyway); well under
    -- pg_net's ceiling.
    timeout_milliseconds := 90000
  );
$$;

-- Internal-only continuation helper: the drain calls it with the service-role
-- client. A raw authenticated/anon EXECUTE would let any caller trigger LLM
-- spend, so lock it to service_role (mirrors the other SECURITY DEFINER RPCs).
revoke execute on function public.poke_analyze_creative(jsonb) from public;
revoke execute on function public.poke_analyze_creative(jsonb) from anon;
revoke execute on function public.poke_analyze_creative(jsonb) from authenticated;

-- ── Verify (run manually after push) ──────────────────────────────────────────
--   SELECT public.poke_analyze_creative('{"account_id":"act_...","limit":1,"chain":1}'::jsonb);
--   SELECT status_code, left(content,120) FROM net._http_response ORDER BY created DESC LIMIT 1;
