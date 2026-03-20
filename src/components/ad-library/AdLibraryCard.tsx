import type { AdLibrarySavedAd } from "@/types/ad-library";
import { useDeleteSavedAd } from "@/hooks/useAdLibrary";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExternalLink, MoreVertical, Trash2, Image, Video, Layers } from "lucide-react";

const mediaIcon: Record<string, typeof Image> = { image: Image, video: Video, carousel: Layers };

interface Props {
  ad: AdLibrarySavedAd;
  onClick?: () => void;
}

export function AdLibraryCard({ ad, onClick }: Props) {
  const deleteAd = useDeleteSavedAd();
  const Icon = mediaIcon[ad.ad_format || "image"] || Image;

  return (
    <Card
      className="group relative flex flex-col overflow-hidden cursor-pointer transition-shadow hover:shadow-card-hover"
      onClick={onClick}
    >
      <div className="relative aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
        {ad.thumbnail_url ? (
          <img src={ad.thumbnail_url} alt={ad.headline || ad.advertiser_name || "Ad"} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Icon className="h-10 w-10 text-sage/30" />
        )}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="secondary" size="sm" className="h-7 w-7 p-0 rounded-md shadow-sm">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {ad.source_url && (
                <DropdownMenuItem onClick={() => window.open(ad.source_url, "_blank")}>
                  <ExternalLink className="h-3.5 w-3.5 mr-2" /> View source
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-destructive" onClick={() => deleteAd.mutate(ad.id)}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {ad.platform && (
          <Badge variant="secondary" className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider">
            {ad.platform}
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        {ad.advertiser_name && (
          <p className="font-label text-[11px] uppercase tracking-wider text-sage truncate">{ad.advertiser_name}</p>
        )}
        {ad.headline && (
          <p className="font-body text-[13px] font-medium text-charcoal line-clamp-2 leading-snug">{ad.headline}</p>
        )}
        {ad.tags && ad.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {ad.tags.slice(0, 3).map((tag) => (
              <Badge key={tag.id} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {tag.name}
              </Badge>
            ))}
            {ad.tags.length > 3 && <span className="text-[10px] text-sage">+{ad.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </Card>
  );
}
