import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface TagInputProps {
  itemId: string;
}

/** Inline tag editor for a single inspiration_item row.
 *
 * Behaviour parity with Creative Vault's TagInput component, adapted to use
 * Verdanote's supabase client (no workspace scoping — RLS handles it).
 */
export function TagInput({ itemId }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: tags = [] } = useQuery({
    queryKey: ["vault-item-tags", itemId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from("inspiration_tags")
        .select("tag")
        .eq("item_id", itemId);
      if (error) throw error;
      return (data ?? []).map((r: { tag: string }) => r.tag);
    },
  });

  const addTag = useMutation({
    mutationFn: async (tag: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from("inspiration_tags")
        .upsert({ item_id: itemId, tag });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault-item-tags", itemId] });
      qc.invalidateQueries({ queryKey: ["vault-tags"] });
    },
  });

  const removeTag = useMutation({
    mutationFn: async (tag: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from("inspiration_tags")
        .delete()
        .eq("item_id", itemId)
        .eq("tag", tag);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault-item-tags", itemId] });
      qc.invalidateQueries({ queryKey: ["vault-tags"] });
    },
  });

  const commit = () => {
    const tag = draft.trim().toLowerCase().replace(/,/g, "");
    if (tag && !tags.includes(tag)) addTag.mutate(tag);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      removeTag.mutate(tags[tags.length - 1]);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex flex-wrap gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm cursor-text min-h-[40px]"
    >
      {tags.map((tag: string) => (
        <span
          key={tag}
          className="flex items-center gap-1 bg-muted rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {tag}
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeTag.mutate(tag);
            }}
            className="hover:text-foreground transition-colors"
            aria-label={`Remove tag ${tag}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={tags.length === 0 ? "Add tags…" : ""}
        className="flex-1 min-w-[80px] bg-transparent outline-none placeholder:text-muted-foreground text-sm"
      />
    </div>
  );
}
