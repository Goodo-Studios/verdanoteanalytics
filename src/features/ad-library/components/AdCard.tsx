import { useState } from "react";
import type { AdLibrarySavedAd, AdLibraryBoard } from "@/features/ad-library/types/ad-library";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  MoreVertical,
  Eye,
  LayoutGrid,
  Tag,
  StickyNote,
  Copy,
  Trash2,
  Image,
  Video,
  Layers,
  Facebook,
  Instagram,
  Calendar,
  Check,
  Captions,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface AdCardProps {
  ad: AdLibrarySavedAd;
  onViewDetails?: (ad: AdLibrarySavedAd) => void;
  onEdit?: (ad: AdLibrarySavedAd) => void;
  onDelete?: (id: string) => void;
  onAddToBoard?: (adId: string, boardId: string) => void;
  onToggleTag?: (adId: string, tagId: string, remove: boolean) => void;
  onUpdateNotes?: (adId: string, notes: string) => void;
  boards?: AdLibraryBoard[];
  allTags?: { id: string; name: string; color: string }[];
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

const platformIcon: Record<string, typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
};

const formatIcon: Record<string, typeof Image> = {
  image: Image,
  video: Video,
  carousel: Layers,
};

const platformColors: Record<string, string> = {
  facebook: "bg-[hsl(220,46%,48%)]/10 text-[hsl(220,46%,48%)] border-[hsl(220,46%,48%)]/20",
  instagram: "bg-[hsl(330,60%,52%)]/10 text-[hsl(330,60%,52%)] border-[hsl(330,60%,52%)]/20",
  tiktok: "bg-foreground/5 text-foreground border-foreground/10",
};

export function AdCard({
  ad,
  onViewDetails,
  onEdit,
  onDelete,
  onAddToBoard,
  onToggleTag,
  onUpdateNotes,
  boards = [],
  allTags = [],
  selectable = false,
  selected = false,
  onToggleSelect,
}: AdCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [noteValue, setNoteValue] = useState(ad.notes || "");
  const [boardPopoverOpen, setBoardPopoverOpen] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const PlatformIcon = platformIcon[ad.platform || ""] || Facebook;
  const FormatIcon = formatIcon[ad.ad_format || "image"] || Image;
  const adTagIds = new Set((ad.tags || []).map((t) => t.id));
  const initial = (ad.advertiser_name || "A")[0].toUpperCase();
  const hasTranscript = (ad as any).transcript_status === "completed";
  const storedMedia = ((ad as any).stored_media || []) as { type: string; download_failed?: boolean; stored_url?: string; file_size_bytes?: number }[];
  const successfulStored = storedMedia.filter(m => !m.download_failed && m.stored_url);
  const hasStoredVideo = successfulStored.some(m => m.type === "video");
  const hasStoredCarousel = successfulStored.filter(m => m.type === "carousel_frame").length > 1;
  const carouselCount = successfulStored.filter(m => m.type === "carousel_frame").length;

  // Detect if the thumbnail is likely a profile pic / logo instead of the actual creative
  const thumbUrl = ad.thumbnail_url || "";
  const isProfilePicThumb = /\/profile|\/avatar|\/logo|page_picture|p\d{2,3}x\d{2,3}|s\d{2,3}x\d{2,3}/i.test(thumbUrl);
  const hasRealCreative = successfulStored.some(m => m.file_size_bytes && m.file_size_bytes > 50000);
  const missingCreative = !hasRealCreative && (successfulStored.length === 0 || isProfilePicThumb) && (!ad.media_urls || ad.media_urls.length === 0);

  const handleCopyLandingPage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (ad.landing_page_url) {
      navigator.clipboard.writeText(ad.landing_page_url);
      toast.success("Landing page URL copied");
    } else {
      toast.error("No landing page URL available");
    }
  };

  const handleSaveNote = () => {
    onUpdateNotes?.(ad.id, noteValue);
    setShowNoteEditor(false);
    toast.success("Note saved");
  };

  return (
    <>
      <Card
        className={cn(
          "group relative flex flex-col overflow-hidden cursor-pointer break-inside-avoid mb-4",
          "transition-all duration-200 ease-out",
          "hover:shadow-card-hover hover:scale-[1.02] hover:border-border",
          "active:scale-[0.98]",
          selected && "ring-2 ring-primary border-primary"
        )}
        onClick={() => {
          if (selectable) {
            onToggleSelect?.(ad.id);
          } else {
            onViewDetails?.(ad);
          }
        }}
      >
        {/* Thumbnail / Placeholder */}
        <div className={cn("relative aspect-[4/3] bg-muted overflow-hidden", missingCreative && "border-2 border-dashed border-destructive/30")}>
          {/* Selection checkbox */}
          {(selectable || selected) && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect?.(ad.id); }}
              className={cn(
                "absolute top-2 left-2 z-10 h-6 w-6 rounded-md flex items-center justify-center transition-all duration-150",
                selected
                  ? "bg-primary text-primary-foreground shadow-card"
                  : "bg-card/80 backdrop-blur-sm border border-border opacity-0 group-hover:opacity-100 hover:bg-card"
              )}
            >
              {selected && <Check className="h-3.5 w-3.5" />}
            </button>
          )}
          {ad.thumbnail_url ? (
            <img
              src={ad.thumbnail_url}
              alt={ad.headline || ad.advertiser_name || "Ad"}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
              <span className="font-heading text-[2rem] text-primary/40 select-none">
                {initial}
              </span>
            </div>
          )}

          {/* Missing creative indicator */}
          {missingCreative && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-destructive/5">
              <div className="text-center px-3">
                <AlertTriangle className="h-5 w-5 text-destructive/60 mx-auto mb-1" />
                <span className="text-[10px] text-destructive/80 font-label">Missing creative</span>
              </div>
            </div>
          )}

          {/* CC badge for transcribed videos */}
          {hasTranscript && (
            <div className="absolute bottom-2 right-10 z-10 h-5 px-1.5 rounded bg-foreground/70 text-background flex items-center gap-0.5">
              <Captions className="h-3 w-3" />
              <span className="text-[9px] font-label font-semibold">CC</span>
            </div>
          )}

          {/* Media type indicator */}
          <div className="absolute bottom-2 right-2 z-10 flex gap-1">
            {hasStoredVideo && (
              <div className="h-5 px-1.5 rounded bg-foreground/70 text-background flex items-center gap-0.5">
                <Video className="h-3 w-3" />
              </div>
            )}
            {hasStoredCarousel && carouselCount > 0 && (
              <div className="h-5 px-1.5 rounded bg-foreground/70 text-background flex items-center gap-0.5">
                <Layers className="h-3 w-3" />
                <span className="text-[9px] font-label font-semibold">{carouselCount}</span>
              </div>
            )}
            {!hasStoredVideo && !hasStoredCarousel && successfulStored.length > 0 && (
              <div className="h-5 px-1.5 rounded bg-foreground/70 text-background flex items-center gap-0.5">
                <Image className="h-3 w-3" />
              </div>
            )}
          </div>

          {/* Hover three-dot menu */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 w-7 p-0 rounded-md shadow-card bg-card/90 backdrop-blur-sm hover:bg-card"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem onClick={() => onViewDetails?.(ad)}>
                  <Eye className="h-3.5 w-3.5 mr-2" /> View Details
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    setBoardPopoverOpen(true);
                  }}
                >
                  <LayoutGrid className="h-3.5 w-3.5 mr-2" /> Add to Board
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    setTagPopoverOpen(true);
                  }}
                >
                  <Tag className="h-3.5 w-3.5 mr-2" /> Edit Tags
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => setShowNoteEditor(true)}>
                  <StickyNote className="h-3.5 w-3.5 mr-2" /> Add Note
                </DropdownMenuItem>

                <DropdownMenuItem onClick={handleCopyLandingPage}>
                  <Copy className="h-3.5 w-3.5 mr-2" /> Copy Landing Page URL
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Card body */}
        <div className="flex flex-col gap-2 p-3">
          {/* Advertiser name */}
          {ad.advertiser_name && (
            <p className="font-body text-sm font-medium text-foreground truncate">
              {ad.advertiser_name}
            </p>
          )}

          {/* Platform + Format badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {ad.platform && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0 font-label uppercase tracking-wider gap-1 border",
                  platformColors[ad.platform] || "bg-muted text-muted-foreground border-border"
                )}
              >
                <PlatformIcon className="h-2.5 w-2.5" />
                {ad.platform}
              </Badge>
            )}
            {ad.ad_format && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 font-label capitalize gap-1 bg-muted/50 text-muted-foreground border-border"
              >
                <FormatIcon className="h-2.5 w-2.5" />
                {ad.ad_format}
              </Badge>
            )}
          </div>

          {/* Body text preview */}
          {ad.body_text && (
            <p className="font-body text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {ad.body_text}
            </p>
          )}

          {/* Tags */}
          {ad.tags && ad.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ad.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag.id}
                  className="text-[10px] font-label px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                >
                  {tag.name}
                </span>
              ))}
              {ad.tags.length > 4 && (
                <span className="text-[10px] text-muted-foreground font-label">
                  +{ad.tags.length - 4}
                </span>
              )}
            </div>
          )}

          {/* Bottom row: date */}
          {ad.started_running && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-label pt-1 border-t border-border-light mt-1">
              <Calendar className="h-3 w-3" />
              <span>Started {format(new Date(ad.started_running), "MMM d, yyyy")}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Board picker popover (rendered outside card to avoid click issues) */}
      <Popover open={boardPopoverOpen} onOpenChange={setBoardPopoverOpen}>
        <PopoverTrigger asChild>
          <span className="hidden" />
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <p className="font-label text-[11px] text-muted-foreground uppercase tracking-wider px-2 pb-2">
            Add to Board
          </p>
          {boards.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-3">No boards yet</p>
          ) : (
            boards.map((board) => (
              <button
                key={board.id}
                onClick={() => {
                  onAddToBoard?.(ad.id, board.id);
                  setBoardPopoverOpen(false);
                }}
                className="w-full text-left text-sm font-body px-2 py-1.5 rounded-md hover:bg-accent transition-colors flex items-center gap-2"
              >
                <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{board.name}</span>
                {board.ad_count !== undefined && (
                  <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                    {board.ad_count}
                  </span>
                )}
              </button>
            ))
          )}
        </PopoverContent>
      </Popover>

      {/* Tag editor popover */}
      <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
        <PopoverTrigger asChild>
          <span className="hidden" />
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <p className="font-label text-[11px] text-muted-foreground uppercase tracking-wider px-2 pb-2">
            Toggle Tags
          </p>
          {allTags.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-3">No tags yet</p>
          ) : (
            allTags.map((tag) => {
              const active = adTagIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => onToggleTag?.(ad.id, tag.id, active)}
                  className={cn(
                    "w-full text-left text-sm font-body px-2 py-1.5 rounded-md transition-colors flex items-center gap-2",
                    active ? "bg-primary/10 text-primary" : "hover:bg-accent"
                  )}
                >
                  <div
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="truncate">{tag.name}</span>
                  {active && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                </button>
              );
            })
          )}
        </PopoverContent>
      </Popover>

      {/* Note editor dialog */}
      <AlertDialog open={showNoteEditor} onOpenChange={setShowNoteEditor}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-forest">Add Note</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-xs">
              Personal notes about this ad
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            rows={4}
            placeholder="What's interesting about this ad..."
            className="text-sm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveNote}>Save Note</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-forest">Delete Ad?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm">
              This will permanently remove this ad from your library and all boards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDelete?.(ad.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
