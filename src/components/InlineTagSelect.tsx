import { useEffect, useRef, useState } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useUpdateCreative } from "@/hooks/useCreatives";
import { TAG_OPTIONS_MAP } from "@/lib/tagOptions";
import { TAG_FIELD_LABELS } from "@/lib/tagDisplay";
import { cn } from "@/lib/utils";

// Radix Select forbids "" as an item value; this sentinel clears the column.
const CLEAR = "__clear__";

interface InlineTagSelectProps {
  adId: string;
  field: "ad_type" | "person" | "style";
  currentValue: string | null;
}

/**
 * Dropdown tag cell for the controlled columns (Ad Type, Person, Creative
 * Type). Always editable: a filled cell shows its value and can be changed or
 * cleared; an empty cell shows "+ tag".
 */
export function InlineTagSelect({ adId, field, currentValue }: InlineTagSelectProps) {
  const updateCreative = useUpdateCreative();
  const [isOpen, setIsOpen] = useState(false);
  const options = TAG_OPTIONS_MAP[field] || [];
  const label = TAG_FIELD_LABELS[field];
  // A stored value outside the vocabulary still shows (and stays selectable).
  const allOptions = currentValue && !options.includes(currentValue) ? [currentValue, ...options] : options;

  return (
    <Select
      open={isOpen}
      onOpenChange={setIsOpen}
      value={currentValue ?? ""}
      onValueChange={(val) => {
        const next = val === CLEAR ? null : val;
        if (next !== (currentValue ?? null)) {
          updateCreative.mutate({ adId, updates: { [field]: next } });
        }
        setIsOpen(false);
      }}
    >
      <SelectTrigger
        aria-label={`${label}: ${currentValue ?? "untagged"}`}
        className={cn(
          "h-6 w-28 text-[11px] bg-transparent px-1.5",
          currentValue ? "border-transparent hover:border-border text-foreground" : "border-dashed text-muted-foreground",
        )}
        onClick={(e) => { e.stopPropagation(); setIsOpen(true); }}
      >
        <SelectValue placeholder="+ tag" />
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {currentValue && <SelectItem value={CLEAR} className="text-xs italic text-muted-foreground">Clear</SelectItem>}
        {allOptions.map((o) => (
          <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface InlineTagTextProps {
  adId: string;
  field: "product" | "hook" | "theme";
  currentValue: string | null;
}

/**
 * Free-text tag cell (Product, Hook, Theme). Click to edit; Enter or blur
 * saves, Escape cancels. Saving an empty value clears the column.
 */
export function InlineTagText({ adId, field, currentValue }: InlineTagTextProps) {
  const updateCreative = useUpdateCreative();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const label = TAG_FIELD_LABELS[field];

  useEffect(() => {
    if (!editing) setDraft(currentValue ?? "");
  }, [currentValue, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Guards against a second commit from the blur that can follow Enter/Escape
  // when the input unmounts.
  const doneRef = useRef(false);

  const startEditing = () => {
    doneRef.current = false;
    setEditing(true);
  };

  const cancel = () => {
    doneRef.current = true;
    setDraft(currentValue ?? "");
    setEditing(false);
  };

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
    const next = draft.trim() === "" ? null : draft.trim();
    if (next !== (currentValue?.trim() || null)) {
      updateCreative.mutate({ adId, updates: { [field]: next } });
    }
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        aria-label={`Edit ${label}`}
        className="h-6 w-36 text-[11px] px-1.5"
        value={draft}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`${label}: ${currentValue ?? "untagged"} (edit)`}
      title={currentValue ?? undefined}
      className={cn(
        "h-6 max-w-[150px] truncate rounded-md border px-1.5 text-left text-[11px]",
        currentValue ? "border-transparent hover:border-border text-foreground" : "border-dashed border-border text-muted-foreground",
      )}
      onClick={(e) => { e.stopPropagation(); startEditing(); }}
    >
      {currentValue || "+ tag"}
    </button>
  );
}
