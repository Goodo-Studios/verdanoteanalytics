import { supabase } from "@/integrations/supabase/client";

export interface VaultDeleteResult {
  requested: number;
  deleted: number;
}

/**
 * Deletes Vault items and reports how many were actually removed.
 *
 * Row-level security turns a delete the user is not allowed to make (for
 * example a teammate's item) into a no-op with no error, so the delete asks for
 * the removed ids back and the caller compares the count (audit plan item 4.6).
 */
export async function deleteVaultItems(ids: string[]): Promise<VaultDeleteResult> {
  if (ids.length === 0) return { requested: 0, deleted: 0 };
  const base = supabase.from("inspiration_items").delete();
  const query = ids.length === 1 ? base.eq("id", ids[0]) : base.in("id", ids);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return { requested: ids.length, deleted: data?.length ?? 0 };
}

/** The toast for a finished delete: success only when every item went. */
export function vaultDeleteMessage({ requested, deleted }: VaultDeleteResult): {
  ok: boolean;
  text: string;
} {
  const noun = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  if (deleted >= requested) {
    return { ok: true, text: requested === 1 ? "Deleted" : `Deleted ${noun(requested)}` };
  }
  if (deleted === 0) {
    return {
      ok: false,
      text:
        requested === 1
          ? "Not deleted. You can only delete items you saved."
          : `${noun(requested)} not deleted. You can only delete items you saved.`,
    };
  }
  return {
    ok: false,
    text: `Deleted ${deleted} of ${requested}. The rest were not deleted because you can only delete items you saved.`,
  };
}
