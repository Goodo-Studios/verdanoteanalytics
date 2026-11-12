// The one call to the os_search database function (OS-015). Kept apart so tests can replace it.
import { supabase } from "@/integrations/supabase/client";
import { cleanRows, type OsSearchRow } from "@/lib/osSearch";

// os_search is not in the generated types yet.
interface RpcBuilder extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  abortSignal(signal: AbortSignal): RpcBuilder;
}
interface Untyped {
  rpc(fn: string, args: Record<string, unknown>): RpcBuilder;
}
const db = supabase as unknown as Untyped;

export async function fetchOsSearch(query: string, signal: AbortSignal, limit = 8): Promise<OsSearchRow[]> {
  const { data, error } = await db.rpc("os_search", { p_query: query, p_limit: limit }).abortSignal(signal);
  if (error) throw new Error(error.message);
  return cleanRows(data);
}
