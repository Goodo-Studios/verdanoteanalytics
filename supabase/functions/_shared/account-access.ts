// Per-account authorization for edge functions that use the SERVICE-ROLE client
// (which bypasses RLS). Agency staff (builder/employee) may access any account;
// everyone else must have a user_accounts link to the account. Mirrors the
// verifyAccountOwnership logic in the `api` function and the get_convention
// database guard, kept in one place so new callers stay consistent.

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export async function hasAccountAccess(
  supabase: SupabaseLike,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (role === "builder" || role === "employee") return true;

  const { data, error } = await supabase
    .from("user_accounts")
    .select("account_id")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .maybeSingle();

  return !error && data !== null;
}
