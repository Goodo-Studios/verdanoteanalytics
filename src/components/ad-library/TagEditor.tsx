import { useState, useRef, useEffect } from "react";
import { useAdLibraryTags, useCreateTag, useToggleAdTag } from "@/hooks/useAdLibrary";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
  allowCreate?: boolean;
}

const TAG_COLORS = [
  "hsl(250, 55%, 58%)", "hsl(200, 65%, 52%)", "hsl(150, 50%, 45%)",
  "hsl(35, 85%, 55%)", "hsl(0, 60%, 55%)", "hsl(280, 50%, 55%)",
  "hsl(170, 55%, 42%)", "hsl(320, 50%, 52%)",
];

export function TagEditor({ selectedTagIds, onChange, allowCreate = true }: Props) {
  const { data: allTags = [] } = useAdLibraryTags();
  const createTag = useCreateTag();
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedSet = new Set(selectedTagIds);
  const selectedTags = allTags.filter((t) => selectedSet.has(t.id));
  const filtered = allTags.filter(
    (t) => !selectedSet.has(t.id) && t.name.toLowerCase().includes(input.toLowerCase())
  );
  const exactMatch = allTags.some((t) => t.name.toLowerCase() === input.trim().toLowerCase());

  const handleRemove = (tagId: string) => {
    onChange(selectedTagIds.filter((id) => id !== tagId));
  };

  const handleAdd = (tagId: string) => {
    onChange([...selectedTagIds, tagId]);
    setInput("");
  };

  const handleCreateAndAdd = () => {
    if (!input.trim() || exactMatch) return;
    const color = TAG_COLORS[allTags.length % TAG_COLORS.length];
    createTag.mutate(
      { name: input.trim(), color },
      {
        onSuccess: (newTag) => {
          onChange([...selectedTagIds, newTag.id]);
          setInput("");
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0) {
        handleAdd(filtered[0].id);
      } else if (allowCreate && input.trim() && !exactMatch) {
        handleCreateAndAdd();
      }
    }
    if (e.key === "Backspace" && !input && selectedTagIds.length > 0) {
      handleRemove(selectedTagIds[selectedTagIds.length - 1]);
    }
  };

  return (
    <div className="space-y-2">
      {/* Selected tags */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 text-[11px] font-label px-2 py-0.5 rounded-full border border-border bg-muted/50 text-foreground"
            >
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
              {tag.name}
              <button
                onClick={() => handleRemove(tag.id)}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input with dropdown */}
      <div className="relative">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Search or create tags..."
          className={cn(
            "w-full h-8 px-3 text-sm rounded-md border border-input bg-background",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
            "transition-shadow"
          )}
        />

        {focused && (input || filtered.length > 0) && (
          <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-md max-h-40 overflow-y-auto">
            {filtered.map((tag) => (
              <button
                key={tag.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAdd(tag.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
              >
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            ))}
            {allowCreate && input.trim() && !exactMatch && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCreateAndAdd}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-primary hover:bg-accent transition-colors border-t border-border"
              >
                <Plus className="h-3.5 w-3.5" />
                Create "{input.trim()}"
              </button>
            )}
            {filtered.length === 0 && !input.trim() && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No more tags</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
