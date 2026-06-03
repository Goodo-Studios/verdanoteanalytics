// useVaultShare — mint / revoke a public share link for a single vault item.
//
// Both actions call the `vault-share-item` edge function (service role) rather
// than touching inspiration_items directly: the library is global so ANY
// authenticated user may share an item, but the table's UPDATE RLS is
// owner-scoped. supabase.functions.invoke attaches the caller's session JWT,
// which the edge function validates before mutating.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const FUNCTION = "vault-share-item";

/** Build the public share URL for a token (origin-relative so it works in any env). */
export function vaultShareUrl(token: string): string {
  return `${window.location.origin}/vault/share/${token}`;
}

export function useVaultShare(itemId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["vault-item", itemId] });

  const mint = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!itemId) throw new Error("No item id");
      const { data, error } = await supabase.functions.invoke(FUNCTION, {
        body: { action: "mint", item_id: itemId },
      });
      if (error) throw error;
      const token = (data as { share_token?: string })?.share_token;
      if (!token) throw new Error("No share token returned");
      return token;
    },
    onSuccess: () => invalidate(),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to create share link"),
  });

  const revoke = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!itemId) throw new Error("No item id");
      const { error } = await supabase.functions.invoke(FUNCTION, {
        body: { action: "revoke", item_id: itemId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Share link disabled");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to disable share link"),
  });

  return { mint, revoke };
}
