import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { saveCreativeToVault } from "@/lib/vaultSave";

/** The vault item a creative maps to (via source_ad_id), or null when it is not saved. */
async function fetchVaultLink(adId: string): Promise<{ id: string; shareToken: string | null } | null> {
  const { data } = await supabase
    .from("inspiration_items")
    .select("id, share_token")
    .eq("source_ad_id", adId)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  // share_token isn't in the generated types (vault tables are hand-typed in
  // types/vault.ts), so read it off the row through a cast.
  const row = data as { id: string; share_token: string | null };
  return { id: row.id, shareToken: row.share_token ?? null };
}

/**
 * Vault state for the creative detail modal: whether the creative is already in the
 * global vault, the vault item id and share token (which Add to board and Share need),
 * and the Save to Vault action.
 */
export function useCreativeVaultState(open: boolean, adId: string | undefined) {
  const [savingToVault, setSavingToVault] = useState(false);
  const [savedToVault, setSavedToVault] = useState(false);
  // true when the saved state came from a dedupe hit / pre-existing vault item,
  // so the button can read "Already in Vault" rather than "Saved".
  const [alreadyInVault, setAlreadyInVault] = useState(false);
  // false until the "is this creative already in the vault?" lookup resolves.
  // Until then the Save-to-Vault affordance is disabled ("Checking…") so it can
  // never be clicked before status is known (a click-then-disable race).
  const [vaultStatusChecked, setVaultStatusChecked] = useState(false);
  const [vaultItemId, setVaultItemId] = useState<string | null>(null);
  const [vaultShareToken, setVaultShareToken] = useState<string | null>(null);

  // Reflect already-in-vault state when the modal opens. The vault library is
  // global, so an item saved by anyone (matched on source_ad_id) marks this
  // creative as saved.
  useEffect(() => {
    if (!open || !adId) return;
    let cancelled = false;
    setSavedToVault(false);
    setAlreadyInVault(false);
    setVaultStatusChecked(false);
    setVaultItemId(null);
    setVaultShareToken(null);
    fetchVaultLink(adId).then((link) => {
      if (cancelled) return;
      if (link) {
        setSavedToVault(true);
        setAlreadyInVault(true);
        setVaultItemId(link.id);
        setVaultShareToken(link.shareToken);
      }
      setVaultStatusChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, adId]);

  const saveToVault = async (creative: Parameters<typeof saveCreativeToVault>[0]) => {
    setSavingToVault(true);
    try {
      const result = await saveCreativeToVault(creative);
      // Read the saved item's id and share token now, so Add to board and Share work
      // straight away instead of after reopening the modal (audit 5.10).
      const link = await fetchVaultLink(creative.ad_id);
      setVaultItemId(link?.id ?? result.itemId ?? null);
      setVaultShareToken(link?.shareToken ?? null);
      setSavedToVault(true);
      if (result.alreadySaved) {
        setAlreadyInVault(true);
        toast.success("Already in Vault");
      } else {
        setAlreadyInVault(false);
        toast.success("Saved to Vault");
      }
    } catch (err: unknown) {
      setSavedToVault(false);
      setAlreadyInVault(false);
      toast.error(err instanceof Error ? err.message : "Failed to save to Vault");
    } finally {
      setSavingToVault(false);
    }
  };

  return {
    savingToVault, savedToVault, alreadyInVault, vaultStatusChecked,
    vaultItemId, vaultShareToken, saveToVault,
  };
}
