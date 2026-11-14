-- claim_sync_continue(bigint, text, text) is SECURITY DEFINER and was created without a
-- search_path (20260530210004), the only such function in the public schema when checked on
-- production on 2026-11-14. A definer function without a fixed search_path resolves names
-- through the caller's path. Pin it to public. Its body only names public.sync_logs and
-- built-ins (jsonb_set, to_jsonb, now), which resolve the same way. Only service_role can
-- execute it. ALTER FUNCTION ... SET keeps the grants and can run again with no effect.

ALTER FUNCTION public.claim_sync_continue(bigint, text, text) SET search_path = public;
