import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccountTaxonomy } from "../hooks/useAccountTaxonomy";
import { saveGovernedTags, type GovernedTagPatch } from "../api";

// Radix <Select> forbids an empty-string item value, so the "Untagged" choice
// uses this UI-only sentinel and is mapped back to a real null on save.
const UNTAGGED = "__untagged__";

/** The creative's current governed axis values (for prefill). */
export interface GovernedTagInitial {
  angle_id?: string | null;
}

interface GovernedTagEditorProps {
  adId: string;
  accountId: string;
  initial?: GovernedTagInitial;
  /** hook is a free-text tag from the ad name — shown read-only for context. */
  hook?: string | null;
  onSaved?: () => void;
}

/**
 * Governed Theme/Persona tagging for one creative, sourced from the account's
 * managed Theme/Persona list (angle_clusters), with an explicit "Untagged"
 * choice.
 *
 * Retired under the Goodo naming convention (2026-09-27): the 90-type creative
 * type menu, its lane, and body are no longer offered here. Their columns and
 * data are untouched — this editor simply never writes them (the save patch
 * carries angle_id only). Creative Type is the `style` tag, edited with the
 * other naming-convention tags.
 *
 * Selecting a Theme/Persona persists the angle_id REFERENCE; the six-dimension
 * tag_source precedence is untouched by this write.
 */
export function GovernedTagEditor({ adId, accountId, initial, hook, onSaved }: GovernedTagEditorProps) {
  const { options, isLoading, isError, error } = useAccountTaxonomy(accountId);
  const queryClient = useQueryClient();

  const [angleId, setAngleId] = useState<string>(initial?.angle_id ?? UNTAGGED);

  useEffect(() => {
    setAngleId(initial?.angle_id ?? UNTAGGED);
  }, [adId, initial?.angle_id]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => {
      const patch: GovernedTagPatch = {
        angle_id: angleId === UNTAGGED ? null : angleId,
      };
      return saveGovernedTags(adId, patch);
    },
    onSuccess: () => {
      toast.success("Theme/Persona saved");
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
        <h3 className="text-sm font-semibold">Theme / Persona</h3>
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

        {/* Hook — free text from the ad name, shown for context. */}
        <div className="space-y-1.5">
          <Label className="text-xs">Hook</Label>
          <p className="h-8 flex items-center text-xs text-muted-foreground truncate" title={hook ?? undefined}>
            {hook || "Untagged"}
          </p>
        </div>
      </div>
    </div>
  );
}
