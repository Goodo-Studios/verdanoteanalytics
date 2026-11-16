import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { fetchCreativeAngleId, saveGovernedTags, type GovernedTagPatch } from "../api";
import { refreshAfterTagChange } from "@/lib/tagRefresh";

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

  // The current value comes from the caller when it has it, otherwise it is read by
  // ad_id. Until it is known, Save stays disabled: saving from the "Untagged"
  // default used to erase the creative's Theme/Persona (audit 5.1).
  const current = useQuery({
    queryKey: ["creative-angle-id", adId],
    queryFn: () => fetchCreativeAngleId(adId),
    enabled: initial === undefined,
    staleTime: 0,
  });
  const currentAngleId: string | null | undefined =
    initial !== undefined ? (initial.angle_id ?? null) : current.data;
  const currentKnown = initial !== undefined || current.isSuccess;

  const [angleId, setAngleId] = useState<string>(UNTAGGED);

  useEffect(() => {
    if (currentKnown) setAngleId(currentAngleId ?? UNTAGGED);
  }, [adId, currentKnown, currentAngleId]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const next = angleId === UNTAGGED ? null : angleId;
      // Nothing changed: skip the write so an untouched Save never rewrites the tag.
      if (next === (currentAngleId ?? null)) return false;
      const patch: GovernedTagPatch = { angle_id: next };
      await saveGovernedTags(adId, patch);
      return true;
    },
    onSuccess: (wrote) => {
      if (wrote) {
        toast.success("Theme/Persona saved");
        void refreshAfterTagChange(queryClient); // every tag screen (audit 5.6)
        void queryClient.invalidateQueries({ queryKey: ["creative-angle-id", adId] });
      }
      onSaved?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save tags"),
  });

  if (isError || current.isError) {
    const err = isError ? error : current.error;
    return (
      <p className="text-sm text-destructive">
        {err instanceof Error ? err.message : "Failed to load account lists"}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Theme / Persona</h3>
        <Button size="sm" onClick={() => save()} disabled={isPending || isLoading || !currentKnown}>
          {isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
          Save
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Theme/Persona — value is the angle_id reference. */}
        <div className="space-y-1.5">
          <Label className="text-xs">Theme / Persona</Label>
          <Select value={angleId} onValueChange={setAngleId} disabled={isLoading || !currentKnown}>
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
