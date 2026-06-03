import { useState } from "react";
import { Check, Copy, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVaultShare, vaultShareUrl } from "../hooks/useVaultShare";

interface Props {
  itemId: string;
  /** Current share token on the item (null when not shared). */
  shareToken: string | null;
}

/**
 * Share control for an item detail page. When the item isn't shared, shows a
 * "Share" button that mints a public link and copies it. Once shared, exposes
 * copy-link + disable actions. Mirrors the ad-board share affordance, but
 * mint/revoke route through the vault-share-item edge function.
 */
export function VaultShareControl({ itemId, shareToken }: Props) {
  const { mint, revoke } = useVaultShare(itemId);
  const [copied, setCopied] = useState(false);

  const copy = async (token: string) => {
    await navigator.clipboard.writeText(vaultShareUrl(token));
    setCopied(true);
    toast.success("Share link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const token = await mint.mutateAsync();
    await copy(token);
  };

  const busy = mint.isPending || revoke.isPending;

  if (!shareToken) {
    return (
      <button
        onClick={handleShare}
        disabled={busy}
        aria-label="Create public share link"
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors",
          busy ? "opacity-50 cursor-not-allowed" : "hover:bg-muted",
        )}
      >
        {mint.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Share2 className="w-3.5 h-3.5" />
        )}
        Share
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => copy(shareToken)}
        aria-label="Copy share link"
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-600" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
        {copied ? "Copied" : "Copy link"}
      </button>
      <button
        onClick={() => revoke.mutate()}
        disabled={busy}
        aria-label="Disable share link"
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors text-muted-foreground",
          busy ? "opacity-50 cursor-not-allowed" : "hover:bg-muted",
        )}
      >
        {revoke.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Share2 className="w-3.5 h-3.5" />
        )}
        Disable link
      </button>
    </div>
  );
}
