import { SavedAd, useUpdateSavedAd, useAdCollections, useAddToCollection } from "@/hooks/useAdLibrary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, ExternalLink, FolderPlus, Image, Video, Layers } from "lucide-react";
import { useState } from "react";

interface Props {
  ad: SavedAd;
  onClose: () => void;
}

const mediaIcon: Record<string, typeof Image> = { image: Image, video: Video, carousel: Layers };

export function AdDetailPanel({ ad, onClose }: Props) {
  const updateAd = useUpdateSavedAd();
  const { data: collections = [] } = useAdCollections();
  const addToCollection = useAddToCollection();
  const [editNotes, setEditNotes] = useState(ad.notes || "");
  const [editTags, setEditTags] = useState(ad.tags?.join(", ") || "");
  const [dirty, setDirty] = useState(false);

  const Icon = mediaIcon[ad.media_type || "image"] || Image;

  const handleSave = () => {
    updateAd.mutate(
      {
        id: ad.id,
        notes: editNotes,
        tags: editTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
      { onSuccess: () => setDirty(false) }
    );
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border-light shadow-modal z-50 flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
        <h3 className="font-heading text-base text-forest truncate">{ad.headline || ad.brand_name || "Ad Detail"}</h3>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Media preview */}
      <div className="aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
        {ad.thumbnail_url ? (
          <img src={ad.thumbnail_url} alt="" className="h-full w-full object-contain" />
        ) : (
          <Icon className="h-16 w-16 text-sage/20" />
        )}
      </div>

      <div className="p-5 space-y-5 flex-1">
        {/* Meta info */}
        <div className="flex items-center gap-2 flex-wrap">
          {ad.brand_name && <Badge variant="secondary">{ad.brand_name}</Badge>}
          {ad.platform && <Badge variant="outline" className="uppercase text-[10px]">{ad.platform}</Badge>}
          {ad.media_type && <Badge variant="outline" className="text-[10px]">{ad.media_type}</Badge>}
          {ad.source === "fb_ad_library" && <Badge className="bg-blue-50 text-blue-700 text-[10px]">Ad Library</Badge>}
        </div>

        {ad.body_text && (
          <div>
            <Label className="text-[11px] text-sage">Ad Copy</Label>
            <p className="font-body text-[13px] text-charcoal mt-1 whitespace-pre-wrap">{ad.body_text}</p>
          </div>
        )}

        {/* Links */}
        <div className="flex gap-2">
          {ad.landing_page_url && (
            <Button variant="outline" size="sm" className="text-[12px]" onClick={() => window.open(ad.landing_page_url!, "_blank")}>
              <ExternalLink className="h-3 w-3 mr-1.5" /> Landing Page
            </Button>
          )}
        </div>

        {/* Tags */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-sage">Tags</Label>
          <Input
            value={editTags}
            onChange={(e) => {
              setEditTags(e.target.value);
              setDirty(true);
            }}
            placeholder="ugc, testimonial, hook"
            className="text-[13px]"
          />
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-sage">Notes</Label>
          <Textarea
            value={editNotes}
            onChange={(e) => {
              setEditNotes(e.target.value);
              setDirty(true);
            }}
            rows={3}
            className="text-[13px]"
          />
        </div>

        {dirty && (
          <Button size="sm" onClick={handleSave} disabled={updateAd.isPending}>
            {updateAd.isPending ? "Saving..." : "Save Changes"}
          </Button>
        )}

        {/* Add to collection */}
        {collections.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-sage">Add to Collection</Label>
            <Select onValueChange={(colId) => addToCollection.mutate({ collection_id: colId, saved_ad_id: ad.id })}>
              <SelectTrigger className="text-[13px]">
                <SelectValue placeholder="Choose collection..." />
              </SelectTrigger>
              <SelectContent>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
