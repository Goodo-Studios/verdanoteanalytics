/**
 * The account a staff user is working in, from `?account_id=` on a creatives write.
 * Returns null when the caller sent no account, an empty value, or "all" (the staff
 * "all accounts" view), in which case the write is not limited to one account.
 * Audit plan item 3.2.
 */
export function workingAccountScope(url: URL): string | null {
  const raw = (url.searchParams.get("account_id") ?? "").trim();
  if (!raw || raw === "all") return null;
  return raw;
}
