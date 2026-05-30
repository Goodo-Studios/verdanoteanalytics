-- Revoke direct authenticated EXECUTE on the hook/angle leaderboard RPCs.
--
-- 20260529100000_rpc_hook_angle_leaderboard.sql granted EXECUTE to both
-- `authenticated` and `service_role`. That migration is already applied to
-- prod, so it is immutable — the fix below ships as a forward migration
-- rather than an edit to the applied file.
--
-- rpc_hook_angle_leaderboard / rpc_hook_angle_coverage are SECURITY DEFINER
-- and trust their p_account_id argument, bypassing creatives RLS. A direct
-- PostgREST call by any authenticated user (e.g. POST /rest/v1/rpc/...) could
-- therefore read any account's spend — a cross-account IDOR. The only
-- sanctioned caller is the `api` edge function, which uses the service-role
-- client and enforces verifyAccountOwnership() before invoking. The UI path
-- (UI -> edge fn -> RPC) is unaffected; only the direct-PostgREST path is closed.

REVOKE EXECUTE ON FUNCTION public.rpc_hook_angle_leaderboard(text, text, int) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_hook_angle_coverage(text, text) FROM authenticated;

-- Re-assert the sanctioned grant (idempotent; no-op if already present).
GRANT EXECUTE ON FUNCTION public.rpc_hook_angle_leaderboard(text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_hook_angle_coverage(text, text) TO service_role;
