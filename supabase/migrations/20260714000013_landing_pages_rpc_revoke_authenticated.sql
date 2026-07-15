-- Landing Pages report (Creative Terminal — Phase 1, Feature 1), US-003 security.
--
-- get_landing_pages_report (US-002) is SECURITY DEFINER and TRUSTS its
-- p_account_id argument. Granting EXECUTE to `authenticated` would let any signed-in
-- user read ANY account's report by passing a different p_account_id — a
-- cross-account IDOR (same class the hook/angle leaderboard closed in
-- 20260530210000). Revoke authenticated EXECUTE; the session-authed `landing-pages`
-- edge function is the only sanctioned caller — it verifies the user JWT, enforces
-- account ownership, then invokes the RPC with the service-role client.
-- Idempotent.

REVOKE EXECUTE ON FUNCTION public.get_landing_pages_report(text, date, date, numeric) FROM authenticated;
-- service_role retains EXECUTE (granted in 20260714000012) for the edge function.
