import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  summarizeSyncPreview, syncFromName, type SyncPreviewSummary,
} from "@/lib/syncFromName";

interface SyncFromNameDialogProps {
  open: boolean;
  onClose: () => void;
  /** creatives.ad_id values to sync. */
  adIds: string[];
  /** Called after a successful apply (after the data refresh is triggered). */
  onApplied?: () => void;
}

type Phase = "previewing" | "preview" | "applying" | "error";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Query keys that hold creative tag data and must refetch after a sync. */
const REFRESH_KEYS = [
  ["creatives"], ["all-creatives"], ["creative-filters"], ["creative-distinct-hooks"],
  ["accounts"], ["creative-library"],
];

/**
 * "Sync from name": dry-run preview of what each ad's name says for the six tag
 * columns, then — on confirm — apply it (overwriting manual tags too) and
 * refresh the creatives data. Errors are shown in the dialog and as a toast.
 */
export function SyncFromNameDialog({ open, onClose, adIds, onApplied }: SyncFromNameDialogProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("previewing");
  const [summary, setSummary] = useState<SyncPreviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<"preview" | "apply">("preview");
  const idsRef = useRef(adIds);
  idsRef.current = adIds;

  const runPreview = useCallback(async () => {
    const ids = idsRef.current;
    setPhase("previewing");
    setError(null);
    setSummary(null);
    try {
      const resp = await syncFromName(ids, true);
      setSummary(summarizeSyncPreview(resp, new Set(ids).size));
      setPhase("preview");
    } catch (e) {
      const msg = errMsg(e);
      setError(msg);
      setFailedStep("preview");
      setPhase("error");
      toast.error("Couldn't preview Sync from name", { description: msg });
    }
  }, []);

  useEffect(() => {
    if (open) void runPreview();
    // Re-run the preview each time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = useCallback(async () => {
    const ids = idsRef.current;
    setPhase("applying");
    setError(null);
    try {
      const resp = await syncFromName(ids, false);
      if (!resp.applied) throw new Error("The server did not confirm the sync was applied.");
      await Promise.all(REFRESH_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      const changedCount = summary?.changed.length ?? 0;
      toast.success(
        `Synced tags from name for ${resp.changes.length} ad${resp.changes.length === 1 ? "" : "s"}`,
        { description: `${changedCount} changed, ${Math.max(0, resp.changes.length - changedCount)} unchanged` },
      );
      onApplied?.();
      onClose();
    } catch (e) {
      const msg = errMsg(e);
      setError(msg);
      setFailedStep("apply");
      setPhase("error");
      toast.error("Sync from name failed", { description: msg });
    }
  }, [queryClient, summary, onApplied, onClose]);

  const busy = phase === "previewing" || phase === "applying";
  const total = new Set(adIds).size;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && phase !== "applying") onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-forest">Sync tags from name</DialogTitle>
          <DialogDescription>
            Reads Ad Type, Person, Creative Type, Product, Hook and Theme from {total === 1 ? "the ad's name" : `the names of ${total} ads`}.
            Applying overwrites the current tags, including ones set by hand. Segments missing from a name are cleared.
          </DialogDescription>
        </DialogHeader>

        {phase === "previewing" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />Checking ad names…
          </div>
        )}

        {phase === "error" && error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">{failedStep === "preview" ? "Preview failed" : "Sync failed"}</p>
              <p className="break-words">{error}</p>
            </div>
          </div>
        )}

        {(phase === "preview" || phase === "applying") && summary && (
          <div className="space-y-3">
            <p className="text-sm" data-testid="sync-summary">
              <span className="font-semibold">{summary.changed.length}</span> ad{summary.changed.length === 1 ? "" : "s"} will change,{" "}
              <span className="font-semibold">{summary.unchangedCount}</span> unchanged
              {summary.missingCount > 0 && <>, <span className="font-semibold">{summary.missingCount}</span> not found</>}.
            </p>
            {summary.changed.length > 0 && (
              <ul className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
                {summary.changed.map((ad) => (
                  <li key={ad.id} className="rounded-md border border-border p-2.5" data-testid="sync-change">
                    <p className="text-[13px] font-medium truncate" title={ad.ad_name}>{ad.ad_name}</p>
                    <ul className="mt-1 space-y-0.5">
                      {ad.diffs.map((d) => (
                        <li key={d.field} className="flex items-center gap-1.5 text-xs">
                          <span className="w-24 flex-shrink-0 text-muted-foreground">{d.label}</span>
                          <span className={d.before ? "" : "italic text-muted-foreground"}>{d.before ?? "empty"}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" aria-label="becomes" />
                          <span className={d.after ? "font-medium" : "italic text-muted-foreground"}>{d.after ?? "empty"}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={phase === "applying"}>Cancel</Button>
          {phase === "error" ? (
            <Button size="sm" onClick={() => (failedStep === "preview" ? runPreview() : apply())}>
              Try again
            </Button>
          ) : (
            <Button size="sm" onClick={apply} disabled={busy || !summary}>
              {phase === "applying" && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
              Apply to {total} ad{total === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
