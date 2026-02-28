import { useParams } from "react-router-dom";
import { usePublicMoodboard, usePublicMoodboardItems } from "@/hooks/useMoodboardsApi";
import { Badge } from "@/components/ui/badge";
import { Loader2, Image as ImageIcon, Link2 } from "lucide-react";
import verdanoteLogo from "@/assets/verdanote_logo.png";

export default function PublicMoodboardPage() {
  const { token } = useParams<{ token: string }>();
  const { data: board, isLoading: loadingBoard } = usePublicMoodboard(token);
  const { data: items = [], isLoading: loadingItems } = usePublicMoodboardItems(board?.id);

  if (loadingBoard) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!board) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="font-heading text-[24px] text-forest mb-2">Board not found</h1>
          <p className="font-body text-[13px] text-muted-foreground">
            This mood board may have been removed or is no longer shared.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border-light px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={verdanoteLogo} alt="Verdanote" className="h-6" />
          <span className="text-muted-foreground/30">|</span>
          <h1 className="font-heading text-[20px] text-forest">{board.name}</h1>
        </div>
        {board.description && (
          <p className="font-body text-[13px] text-muted-foreground">{board.description}</p>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {loadingItems ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-center font-body text-[13px] text-muted-foreground py-20">This board is empty.</p>
        ) : (
          <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4">
            {items.map((item: any) => (
              <div key={item.id} className="break-inside-avoid glass-panel overflow-hidden">
                {item.thumbnail_url ? (
                  <img src={item.thumbnail_url} alt="" className="w-full object-cover" loading="lazy" />
                ) : (
                  <div className="aspect-square bg-muted flex items-center justify-center">
                    {item.type === "url" ? (
                      <Link2 className="h-8 w-8 text-muted-foreground/30" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                    )}
                  </div>
                )}
                {item.caption && (
                  <div className="p-2.5">
                    <p className="font-body text-[11px] text-slate line-clamp-3">{item.caption}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
