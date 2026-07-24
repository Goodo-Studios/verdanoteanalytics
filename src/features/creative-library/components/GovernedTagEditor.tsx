import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HOOK_OPTIONS } from "@/lib/tagOptions";
import { useAccountTaxonomy } from "../hooks/useAccountTaxonomy";
import { saveGovernedTags, type GovernedTagPatch } from "../api";

// Radix <Select> forbids an empty-string item value, so the "Untagged" choice
// uses this UI-only sentinel and is mapped back to a real null on save.
const UNTAGGED = "__untagged__";

/** The creative's current governed axis values (for prefill). */
export interface GovernedTagInitial {
  angle_id?: string | null;
  creative_type?: string | null;
  creative_lane?: string | null;
  body?: string | null;
}

interface GovernedTagEditorProps {
  adId: string;
  accountId: string;
  initial?: GovernedTagInitial;
  /** hook is the existing (static) tag — shown read-context only, not governed. */
  hook?: string | null;
  onSaved?: () => void;
}

/**
 * US-004: governed matrix-axis tagging for one creative. Every dropdown sources
 * its options from the account's managed lists (Theme/Persona from angle_clusters,
 * creative type from the account's activated house-menu types grouped by lane,
 * body from the account's body vocabulary). hook remains the existing static tag.
 * Each governed dimension offers an explicit "Untagged" choice.
 *
 * Selecting a Theme/Persona persists the angle_id REFERENCE (not the free-text
 * theme); the six-dimension tag_source precedence is untouched by this write.
 */
export function GovernedTagEditor({ adId, accountId, initial, hook, onSaved }: GovernedTagEditorProps) {
  const { options, isLoading, isError, error } = useAccountTaxonomy(accountId);
  const queryClient = useQueryClient();

  const [angleId, setAngleId] = useState<string>(initial?.angle_id ?? UNTAGGED);
  const [creativeType, setCreativeType] = useState<string>(initial?.creative_type ?? UNTAGGED);
  const [body, setBody] = useState<string>(initial?.body ?? UNTAGGED);

  useEffect(() => {
    setAngleId(initial?.angle_id ?? UNTAGGED);
    setCreativeType(initial?.creative_type ?? UNTAGGED);
    setBody(initial?.body ?? UNTAGGED);
  }, [adId, initial?.angle_id, initial?.creative_type, initial?.body]);

  // Map a chosen creative_type back to its lane (needed to persist creative_lane).
  const laneForType = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of options.creativeTypeGroups) {
      for (const t of g.types) map.set(t.value, g.lane);
    }
    return map;
  }, [options.creativeTypeGroups]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => {
      const patch: GovernedTagPatch = {
        angle_id: angleId === UNTAGGED ? null : angleId,
        creative_type: creativeType === UNTAGGED ? null : creativeType,
        creative_lane: creativeType === UNTAGGED ? null : (laneForType.get(creativeType) ?? null),
        body: body === UNTAGGED ? null : body,
      };
      return saveGovernedTags(adId, patch);
    },
    onSuccess: () => {
      toast.success("Matrix tags saved");
      void queryClient.invalidateQueries({ queryKey: ["creative-library"] });
      void queryClient.invalidateQueries({ queryKey: ["creatives"] });
      onSaved?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save tags"),
  });

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load account lists"}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Matrix tags</h3>
        <Button size="sm" onClick={() => save()} disabled={isPending || isLoading}>
          {isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
          Save
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Theme/Persona — value is the angle_id reference. */}
        <div className="space-y-1.5">
          <Label className="text-xs">Theme / Persona</Label>
          <Select value={angleId} onValueChange={setAngleId} disabled={isLoading}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select Theme/Persona" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNTAGGED}>Untagged</SelectItem>
              {options.themes.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Creative type — grouped by house lane, active types only. */}
        <div className="space-y-1.5">
          <Label className="text-xs">Creative type</Label>
          <Select value={creativeType} onValueChange={setCreativeType} disabled={isLoading}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select creative type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNTAGGED}>Untagged</SelectItem>
              {options.creativeTypeGroups.map((g) => (
                <SelectGroup key={g.lane}>
                  <SelectLabel>{g.lane}</SelectLabel>
                  {g.types.map((t) => (
                    <SelectItem key={`${g.lane}:${t.value}`} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Body — from the account's body vocabulary. */}
        <div className="space-y-1.5">
          <Label className="text-xs">Body</Label>
          <Select value={body} onValueChange={setBody} disabled={isLoading}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select body" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNTAGGED}>Untagged</SelectItem>
              {options.bodies.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Hook — the existing static tag, shown for context (not governed here). */}
        <div className="space-y-1.5">
          <Label className="text-xs">Hook</Label>
          <Select value={hook ?? UNTAGGED} disabled>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNTAGGED}>Untagged</SelectItem>
              {HOOK_OPTIONS.map((h) => (
                <SelectItem key={h} value={h}>{h}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
