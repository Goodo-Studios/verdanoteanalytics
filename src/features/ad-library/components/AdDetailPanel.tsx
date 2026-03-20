import type { AdLibrarySavedAd } from "@/features/ad-library/types/ad-library";
import { useUpdateSavedAd, useAdLibraryBoards, useAddToBoard, useAdLibraryTags, useToggleAdTag } from "@/features/ad-library/hooks/useAdLibrary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, ExternalLink, Image, Video, Layers } from "lucide-react";
import { useState } from "react";

interface Props {
  ad: AdLibrarySavedAd;
  onClose: () => void;
}

const mediaIcon: Record<string, typeof Image> = { image: Image, video: Video, carousel: Layers };

export function AdDetailPanel({ ad, onClose }: Props) {
  const updateAd = useUpdateSavedAd();
  const { data: boards = [] } = useAdLibraryBoards();
  const addToBoard = useAddToBoard();
  const { data: allTags = [] } = useAdLibraryTags();
  const toggleTag = useToggleAdTag();
  const [editNotes, setEditNotes] = useState(ad.notes || "");
  const [dirty, setDirty] = useState(false);

  const Icon = mediaIcon[ad.ad_format || "image"] || Image;
  const adTagIds = new Set((ad.tags || []).map((t) => t.id));

  const handleSave = () => {
    updateAd.mutate({ id: ad.id, notes: editNotes }, { onSuccess: () => setDirty(false) });
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border-light shadow-modal z-50 flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
        <h3 className="font-heading text-base text-forest truncate">{ad.headline || ad.advertiser_name || "Ad Detail"}</h3>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
        {ad.thumbnail_url ? (
          <img src={ad.thumbnail_url} alt="" className="h-full w-full object-contain" />
        ) : (
          <Icon className="h-16 w-16 text-sage/20" />
        )}
      </div>

      <div className="p-5 space-y-5 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {ad.advertiser_name && <Badge variant="secondary">{ad.advertiser_name}</Badge>}
          {ad.platform && <Badge variant="outline" className="uppercase text-[10px]">{ad.platform}</Badge>}
          {ad.ad_format && <Badge variant="outline" className="text-[10px]">{ad.ad_format}</Badge>}
          {ad.cta_text && <Badge variant="outline" className="text-[10px]">{ad.cta_text}</Badge>}
        </div>

        {ad.body_text && (
          <div>
            <Label className="text-[11px] text-sage">Ad Copy</Label>
            <p className="font-body text-[13px] text-charcoal mt-1 whitespace-pre-wrap">{ad.body_text}</p>
          </div>
        )}

        <div className="flex gap-2">
          {ad.source_url && (
            <Button variant="outline" size="sm" className="text-[12px]" onClick={() => window.open(ad.source_url, "_blank")}>
              <ExternalLink className="h-3 w-3 mr-1.5" /> View Source
            </Button>
          )}
          {ad.landing_page_url && (
            <Button variant="outline" size="sm" className="text-[12px]" onClick={() => window.open(ad.landing_page_url!, "_blank")}>
              <ExternalLink className="h-3 w-3 mr-1.5" /> Landing Page
            </Button>
          )}
        </div>

        {/* Tags */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-sage">Tags</Label>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggleTag.mutate({ ad_id: ad.id, tag_id: tag.id, remove: adTagIds.has(tag.id) })}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  adTagIds.has(tag.id)
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-background text-muted-foreground border-border hover:border-accent"
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-sage">Notes</Label>
          <Textarea
            value={editNotes}
            onChange={(e) => { setEditNotes(e.target.value); setDirty(true); }}
            rows={3}
            className="text-[13px]"
          />
        </div>

        {dirty && (
          <Button size="sm" onClick={handleSave} disabled={updateAd.isPending}>
            {updateAd.isPending ? "Saving..." : "Save Changes"}
          </Button>
        )}

        {/* Add to board */}
        {boards.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-sage">Add to Board</Label>
            <Select onValueChange={(boardId) => addToBoard.mutate({ board_id: boardId, ad_id: ad.id })}>
              <SelectTrigger className="text-[13px]"><SelectValue placeholder="Choose board..." /></SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
