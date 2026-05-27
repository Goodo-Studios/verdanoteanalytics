import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertCircle, MoreHorizontal, Check, Star, Trash2, LayoutGrid } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import { useRolePrefix } from "@/hooks/useRolePath";
import { supabase } from "@/integrations/supabase/client";
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  STATUS_LABELS,
  VAULT_PROCESSING_STATUSES,
  type InspirationItem,
} from "../types/vault";
import { AddToBoardModal } from "./AddToBoardModal";

interface Props {
  item: InspirationItem;
  hookPreview?: string | null;
  hookVerbal?: string | null;
  hookText?: string | null;
  framework?: string | null;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onToggleFeatured?: (id: string, featured: boolean) => void;
  onDelete?: (id: string) => void;
}

export function InspirationCard({
  item,
  hookPreview,
  hookVerbal,
  hookText,
  selected = false,
  onSelect,
  onToggleFeatured,
  onDelete,
}: Props) {
  const prefix = useRolePrefix();
  const isProcessing = VAULT_PROCESSING_STATUSES.has(item.status);
  const isError = item.status === "error";
  const [isHovered, setIsHovered] = useState(false);
  const [signedFileUrl, setSignedFileUrl] = useState<string | null>(null);
  const [signedThumbnailUrl, setSignedThumbnailUrl] = useState<string | null>(null);
  const [firstFrameUrl, setFirstFrameUrl] = useState<string | null>(null);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [addToBoardOpen, setAddToBoardOpen] = useState(false);

  const isImageFile = /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(item.file_path ?? "");

  // Stored thumbnail (preferred — bypasses CDN hotlink restrictions).
  useEffect(() => {
    if (!item.thumbnail_path) return;
    supabase.storage
      .from("inspiration-media")
      .createSignedUrl(item.thumbnail_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setSignedThumbnailUrl(data.signedUrl);
      });
  }, [item.thumbnail_path]);

  // Signed URL for the original file (used for hover playback + first-frame extraction).
  useEffect(() => {
    if (!item.file_path) return;
    supabase.storage
      .from("inspiration-media")
      .createSignedUrl(item.file_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setSignedFileUrl(data.signedUrl);
      });
  }, [item.file_path]);

  // First-frame fallback when no usable thumbnail.
  useEffect(() => {
    const hasThumbnail = signedThumbnailUrl || (item.thumbnail_url && !thumbnailError);
    if (!signedFileUrl || isImageFile || hasThumbnail) return;
    let cancelled = false;

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";

    const onSeeked = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 360;
      canvas.height = video.videoHeight || 640;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          setFirstFrameUrl(canvas.toDataURL("image/jpeg", 0.85));
        } catch {
          /* CORS-blocked frame — silently skip */
        }
      }
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener(
      "loadedmetadata",
      () => {
        video.currentTime = 0.001;
      },
      { once: true },
    );
    video.src = signedFileUrl;
    video.load();

    return () => {
      cancelled = true;
    };
  }, [signedFileUrl, isImageFile, item.thumbnail_url, signedThumbnailUrl, thumbnailError]);

  const visibleHook = hookVerbal ?? hookPreview ?? null;
  const platformKey = item.platform ?? "unknown";

  return (
    <div
      className={cn(
        "group relative block rounded-xl overflow-hidden border bg-card hover:shadow-md transition-shadow",
        selected ? "border-primary shadow-md ring-1 ring-primary/40" : "border-border",
      )}
    >
      <Link to={`${prefix}/ad-library/${item.id}`} className="block">
        <div
          className="relative aspect-[9/16] bg-muted overflow-hidden"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {isHovered && (item.video_url ?? signedFileUrl) ? (
            <video
              src={item.video_url ?? signedFileUrl ?? undefined}
              autoPlay
              muted
              playsInline
              loop
              className="w-full h-full object-cover"
            />
          ) : signedThumbnailUrl ? (
            <img
              src={signedThumbnailUrl}
              alt={item.title ?? "Inspiration"}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : item.thumbnail_url && !thumbnailError ? (
            <img
              src={item.thumbnail_url}
              alt={item.title ?? "Inspiration"}
              onError={() => setThumbnailError(true)}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : signedFileUrl && isImageFile ? (
            <img
              src={signedFileUrl}
              alt={item.title ?? "Inspiration"}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : firstFrameUrl ? (
            <img
              src={firstFrameUrl}
              alt={item.title ?? "Inspiration"}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : signedFileUrl ? (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
              No thumbnail
            </div>
          )}

          <span
            className={cn(
              "absolute top-2 left-2 text-xs font-medium px-2 py-0.5 rounded-full",
              PLATFORM_COLORS[platformKey] ?? PLATFORM_COLORS.unknown,
            )}
          >
            {PLATFORM_LABELS[platformKey] ?? PLATFORM_LABELS.unknown}
          </span>

          {(isProcessing || isError) && (
            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
              {isError ? (
                <AlertCircle className="text-red-400 w-8 h-8" />
              ) : (
                <Loader2 className="text-white w-8 h-8 animate-spin" />
              )}
              <span className="text-white text-xs font-medium">
                {STATUS_LABELS[item.status] ?? item.status}
              </span>
            </div>
          )}

          {item.is_featured && (
            <span className="absolute top-2 right-8 z-10">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 drop-shadow" />
            </span>
          )}
        </div>

        <div className="p-4 space-y-2">
          {visibleHook ? (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-0.5">
                Hook Verbal
              </p>
              <p className="text-sm text-muted-foreground line-clamp-3">{visibleHook}</p>
            </div>
          ) : item.brand_name || item.title || item.creator_handle ? (
            <p className="text-sm font-medium text-foreground line-clamp-1">
              {item.brand_name ?? item.title ?? `@${item.creator_handle}`}
            </p>
          ) : isError ? (
            <p className="text-sm text-red-400 italic">Extraction failed</p>
          ) : isProcessing ? (
            <p className="text-sm text-muted-foreground italic">Processing…</p>
          ) : null}

          {hookText && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-sky-500/70 mb-0.5">
                Hook Text
              </p>
              <p className="text-sm text-muted-foreground line-clamp-2">{hookText}</p>
            </div>
          )}
        </div>
      </Link>

      {onSelect && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(item.id);
          }}
          className={cn(
            "absolute top-2 left-2 z-20 w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
            selected
              ? "bg-primary border-primary text-white opacity-100"
              : "border-white/90 bg-black/40 opacity-0 group-hover:opacity-100",
          )}
        >
          {selected && <Check className="w-3 h-3" />}
        </button>
      )}

      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
              onClick={(e) => e.preventDefault()}
              aria-label="Card actions"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 min-w-[152px] rounded-lg border border-border bg-background shadow-lg p-1 animate-in zoom-in-95"
              sideOffset={4}
              align="end"
            >
              {onToggleFeatured && (
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-muted transition-colors outline-none"
                  onSelect={() => onToggleFeatured(item.id, !item.is_featured)}
                >
                  <Star
                    className={cn(
                      "w-3.5 h-3.5",
                      item.is_featured ? "text-amber-500 fill-amber-500" : "text-muted-foreground",
                    )}
                  />
                  {item.is_featured ? "Unfeature" : "Feature"}
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-muted transition-colors outline-none"
                onSelect={() => setAddToBoardOpen(true)}
              >
                <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground" />
                Add to board
              </DropdownMenu.Item>
              {onDelete && (
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-muted transition-colors outline-none text-destructive"
                  onSelect={() => onDelete(item.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <AddToBoardModal
        itemId={item.id}
        open={addToBoardOpen}
        onOpenChange={setAddToBoardOpen}
      />
    </div>
  );
}
