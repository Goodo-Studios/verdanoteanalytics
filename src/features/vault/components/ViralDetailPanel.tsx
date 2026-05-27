import { X, ExternalLink, Eye, Heart, Share2, BookmarkPlus, Check, Flame, Clock } from "lucide-react";
import { PLATFORM_LABELS } from "../types/vault";

/** A viral_feed_items row as needed for the detail panel.
 *
 * Mirrors `repos/private/creative-vault/src/components/ViralDetailPanel.tsx`.
 * Kept self-contained (not coupled to LibraryItem) since viral feed rows live
 * in a separate global table — see migration 20260527000001_vault_schema.sql.
 */
export type ViralDetailItem = {
  id: string;
  platform: string;
  source_url: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  creator_handle: string | null;
  view_count: number | null;
  like_count: number | null;
  share_count: number | null;
  first_seen_at: string;
  fetched_at: string;
  category: string | null;
  is_saved: boolean;
};

interface Props {
  item: ViralDetailItem | null;
  onClose: () => void;
  onSave: (item: ViralDetailItem) => void;
}

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function daysRunning(firstSeenAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(firstSeenAt).getTime()) / 86_400_000));
}

/** Right-side detail drawer for a viral_feed_items row.
 *
 * Read-only view of the item plus a single Save-to-Vault CTA. The save flow
 * is owned by `ViralFeedPage` (this component just emits a callback).
 */
export default function ViralDetailPanel({ item, onClose, onSave }: Props) {
  const open = item !== null;

  return (
    <>
      {/* Backdrop (mobile-only) */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-sm bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {!item ? null : (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-sm font-semibold">
                {PLATFORM_LABELS[item.platform] ?? item.platform} · Detail
              </span>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                aria-label="Close detail panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="relative aspect-[9/16] bg-muted max-h-72 overflow-hidden">
                {item.thumbnail_url ? (
                  <img
                    src={item.thumbnail_url}
                    alt={item.title ?? ""}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                    No preview
                  </div>
                )}
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition-colors"
                  title="Open original"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {item.creator_handle && (
                      <p className="text-sm text-muted-foreground">@{item.creator_handle}</p>
                    )}
                    {item.title && (
                      <p className="text-sm font-medium leading-snug mt-0.5">{item.title}</p>
                    )}
                  </div>
                  {item.category && (
                    <span className="shrink-0 bg-secondary text-secondary-foreground text-[10px] font-medium px-2 py-0.5 rounded-full">
                      {item.category}
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  {daysRunning(item.first_seen_at) === 0 ? (
                    <span className="flex items-center gap-1 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                      <Flame className="w-3 h-3" /> New
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                      <Clock className="w-3 h-3" /> {daysRunning(item.first_seen_at)}d running
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: Eye, label: "Views", value: formatCount(item.view_count) },
                    { icon: Heart, label: "Likes", value: formatCount(item.like_count) },
                    { icon: Share2, label: "Shares", value: formatCount(item.share_count) },
                  ].map(({ icon: Icon, label, value }) => (
                    <div
                      key={label}
                      className="flex flex-col items-center py-2 px-1 rounded-lg bg-muted/60 gap-1"
                    >
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm font-semibold">{value}</span>
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>

                {item.description && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                    <p className="text-sm text-foreground leading-relaxed">{item.description}</p>
                  </div>
                )}

                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  View original
                </a>
              </div>
            </div>

            <div className="shrink-0 px-4 py-3 border-t border-border">
              {item.is_saved ? (
                <div className="flex items-center justify-center gap-2 text-sm text-green-600 font-medium py-2">
                  <Check className="w-4 h-4" /> Already in Vault
                </div>
              ) : (
                <button
                  onClick={() => onSave(item)}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <BookmarkPlus className="w-4 h-4" />
                  Save to Vault
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
