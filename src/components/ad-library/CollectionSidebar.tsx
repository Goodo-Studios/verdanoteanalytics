import { useState } from "react";
import { useAdCollections, useCreateCollection } from "@/hooks/useAdLibrary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderPlus, Library, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  selectedCollectionId: string | null;
  onSelect: (id: string | null) => void;
}

export function CollectionSidebar({ selectedCollectionId, onSelect }: Props) {
  const { data: collections = [] } = useAdCollections();
  const createCollection = useCreateCollection();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");

  const handleCreate = () => {
    if (!newName.trim()) return;
    createCollection.mutate(
      { name: newName.trim() },
      {
        onSuccess: () => {
          setNewName("");
          setShowNew(false);
        },
      }
    );
  };

  return (
    <div className="w-52 flex-shrink-0 border-r border-border-light bg-background">
      <div className="p-3 space-y-1">
        <p className="font-label text-[9px] uppercase tracking-[0.1em] text-sage px-2 pb-1">Library</p>
        <button
          onClick={() => onSelect(null)}
          className={cn(
            "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-[13px] font-body font-medium transition-colors",
            selectedCollectionId === null
              ? "bg-sage-light text-forest"
              : "text-slate hover:text-forest hover:bg-accent"
          )}
        >
          <Library className="h-4 w-4 flex-shrink-0" />
          All Saved Ads
        </button>

        <div className="pt-3 pb-1 flex items-center justify-between px-2">
          <p className="font-label text-[9px] uppercase tracking-[0.1em] text-sage">Collections</p>
          <button
            onClick={() => setShowNew(true)}
            className="text-sage hover:text-forest transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        {showNew && (
          <div className="px-1 pb-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Collection name"
              className="h-8 text-[12px]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setShowNew(false);
              }}
            />
            <div className="flex gap-1 mt-1">
              <Button size="sm" className="h-6 text-[11px] px-2" onClick={handleCreate} disabled={createCollection.isPending}>
                Create
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {collections.map((col) => (
          <button
            key={col.id}
            onClick={() => onSelect(col.id)}
            className={cn(
              "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-[13px] font-body font-medium transition-colors",
              selectedCollectionId === col.id
                ? "bg-sage-light text-forest"
                : "text-slate hover:text-forest hover:bg-accent"
            )}
          >
            <Folder className="h-4 w-4 flex-shrink-0" />
            <span className="truncate flex-1 text-left">{col.name}</span>
            {(col.item_count ?? 0) > 0 && (
              <span className="text-[10px] text-sage tabular-nums">{col.item_count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
