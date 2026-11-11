// The "View asset" button on a card: opens the Air review link in a new tab. Shows nothing when the card
// has no link, or when the stored value is not a valid Air link (safeAssetLink checks the address again
// before it becomes an href). The same component is used on the client board and on the staff pages.
import { ExternalLink } from "lucide-react";
import { safeAssetLink } from "@/lib/airLink";

export function ViewAssetLink({ link, className = "" }: { link: string | null | undefined; className?: string }) {
  const href = safeAssetLink(link);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-[6px] border border-input px-2 py-1 font-body text-[12px] text-foreground transition-colors hover:bg-accent ${className}`}
      data-testid="view-asset"
    >
      View asset
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
