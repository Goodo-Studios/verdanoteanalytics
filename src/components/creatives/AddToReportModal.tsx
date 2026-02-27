import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useReports } from "@/hooks/useReportsApi";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AddToReportModalProps {
  open: boolean;
  onClose: () => void;
  adIds: string[];
  creatives: any[];
}

export function AddToReportModal({ open, onClose, adIds, creatives }: AddToReportModalProps) {
  const { data: reports = [], isLoading } = useReports();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!selectedReportId) return;
    setSaving(true);
    try {
      const report = (reports as any[]).find((r: any) => r.id === selectedReportId);
      if (!report) throw new Error("Report not found");

      // Build featured creatives from selected ids
      const featured = creatives
        .filter((c: any) => adIds.includes(c.ad_id))
        .map((c: any) => ({
          ad_id: c.ad_id,
          ad_name: c.ad_name,
          roas: c.roas,
          spend: c.spend,
          cpa: c.cpa,
        }));

      // Merge with existing top_performers
      let existing: any[] = [];
      try { existing = JSON.parse(report.top_performers || "[]"); } catch {}
      const merged = [...existing, ...featured.filter((f: any) => !existing.some((e: any) => e.ad_id === f.ad_id))];

      const { error } = await supabase
        .from("reports")
        .update({ top_performers: JSON.stringify(merged) })
        .eq("id", selectedReportId);

      if (error) throw error;
      toast.success(`Added ${featured.length} creatives to "${report.report_name}"`);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to add to report");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-forest">Add to Report</DialogTitle>
        </DialogHeader>
        <p className="font-body text-[13px] text-muted-foreground">
          Select a report to append {adIds.length} creative{adIds.length !== 1 ? "s" : ""} as featured performers.
        </p>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (reports as any[]).length === 0 ? (
          <p className="font-body text-[13px] text-muted-foreground py-6 text-center">
            No reports found. Generate a report first.
          </p>
        ) : (
          <div className="max-h-[240px] overflow-y-auto space-y-1 py-2">
            {(reports as any[]).map((r: any) => (
              <button
                key={r.id}
                onClick={() => setSelectedReportId(r.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                  selectedReportId === r.id
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-accent border border-transparent"
                )}
              >
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-body text-[13px] font-medium text-foreground truncate">{r.report_name}</div>
                  <div className="font-body text-[11px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()} · {r.creative_count || 0} creatives
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleAdd} disabled={!selectedReportId || saving}>
            {saving && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
            Add to Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
