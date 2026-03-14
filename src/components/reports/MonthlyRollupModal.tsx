import { useState, useMemo, useCallback } from "react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CalendarIcon, Loader2, FileText, CheckCircle2, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface MonthlyRollupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: any[];
}

type Phase = "config" | "generating" | "complete";

interface RollupResult {
  total: number;
  success_count: number;
  shared_count: number;
  results: Array<{
    account_id: string;
    account_name: string;
    report_id?: string;
    shared_count?: number;
    success: boolean;
    error?: string;
  }>;
}

export function MonthlyRollupModal({ open, onOpenChange, accounts }: MonthlyRollupModalProps) {
  const queryClient = useQueryClient();
  const lastMonth = subMonths(new Date(), 1);

  const [dateStart, setDateStart] = useState<Date>(startOfMonth(lastMonth));
  const [dateEnd, setDateEnd] = useState<Date>(endOfMonth(lastMonth));
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set(accounts.map(a => a.id)));
  const [autoShare, setAutoShare] = useState(false);
  const [phase, setPhase] = useState<Phase>("config");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<RollupResult | null>(null);

  const allSelected = selectedAccounts.size === accounts.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedAccounts(new Set());
    } else {
      setSelectedAccounts(new Set(accounts.map(a => a.id)));
    }
  };

  const toggleAccount = (id: string) => {
    setSelectedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleGenerate = useCallback(async () => {
    const accountIds = Array.from(selectedAccounts);
    if (accountIds.length === 0) return;

    setPhase("generating");
    setProgress(0);

    try {
      // Single batch call to the rollup endpoint
      const data = await apiFetch("reports", "rollup", {
        method: "POST",
        body: JSON.stringify({
          account_ids: accountIds,
          date_start: format(dateStart, "yyyy-MM-dd"),
          date_end: format(dateEnd, "yyyy-MM-dd"),
          auto_share: autoShare,
        }),
      });

      setResult(data);
      setPhase("complete");
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success(`${data.success_count} reports generated`);
    } catch (err) {
      console.error("Rollup error:", err);
      toast.error("Error generating reports");
      setPhase("config");
    }
  }, [selectedAccounts, dateStart, dateEnd, autoShare, queryClient]);

  const handleClose = () => {
    onOpenChange(false);
    // Reset after close animation
    setTimeout(() => {
      setPhase("config");
      setResult(null);
      setProgress(0);
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg bg-card rounded-[8px] shadow-modal p-7">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-[22px] text-forest">
            <FileText className="h-5 w-5 text-sage" />
            Generate Monthly Reports
          </DialogTitle>
          <DialogDescription className="font-body text-[13px] text-slate font-light">
            Generate performance reports for multiple accounts at once.
          </DialogDescription>
        </DialogHeader>

        {phase === "config" && (
          <div className="space-y-5">
            {/* Date Range */}
            <div className="space-y-1.5">
              <Label className="font-body text-[14px] font-medium text-charcoal">Date Range</Label>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-9 flex-1 justify-start border-border-light rounded-[4px]", "font-data text-[17px] font-medium text-charcoal")}>
                      <CalendarIcon className="h-3.5 w-3.5 mr-1.5 text-sage" />
                      {format(dateStart, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateStart} onSelect={(d) => d && setDateStart(d)} disabled={(d) => d > new Date()} className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
                <span className="font-body text-[13px] text-sage">to</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-9 flex-1 justify-start border-border-light rounded-[4px]", "font-data text-[17px] font-medium text-charcoal")}>
                      <CalendarIcon className="h-3.5 w-3.5 mr-1.5 text-sage" />
                      {format(dateEnd, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateEnd} onSelect={(d) => d && setDateEnd(d)} disabled={(d) => d > new Date()} className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Account Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-body text-[14px] font-medium text-charcoal">Accounts</Label>
                <button onClick={toggleAll} className="font-body text-[12px] text-primary hover:underline">
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="max-h-[200px] overflow-y-auto border border-border-light rounded-[6px] divide-y divide-border-light">
                {accounts.map(a => (
                  <label key={a.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-accent/40 transition-colors">
                    <Checkbox
                      checked={selectedAccounts.has(a.id)}
                      onCheckedChange={() => toggleAccount(a.id)}
                    />
                    <span className="font-body text-[13px] text-charcoal">{a.name}</span>
                    <span className="font-data text-[11px] text-muted-foreground ml-auto tabular-nums">{a.creative_count} creatives</span>
                  </label>
                ))}
              </div>
              <p className="font-data text-[11px] text-muted-foreground tabular-nums">
                {selectedAccounts.size} of {accounts.length} accounts selected
              </p>
            </div>

            {/* Auto-share toggle */}
            <div className="flex items-center justify-between py-2">
              <div>
                <Label className="font-body text-[14px] font-medium text-charcoal">Auto-share with clients</Label>
                <p className="font-body text-[11px] text-muted-foreground mt-0.5">
                  Creates public links and notifies linked client users
                </p>
              </div>
              <Switch checked={autoShare} onCheckedChange={setAutoShare} />
            </div>
          </div>
        )}

        {phase === "generating" && (
          <div className="py-10 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-body text-[14px] text-charcoal">
              Generating reports for {selectedAccounts.size} accounts…
            </p>
            <p className="font-body text-[12px] text-muted-foreground">
              This includes AI-powered performance highlights and may take a moment.
            </p>
          </div>
        )}

        {phase === "complete" && result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="glass-panel p-4 text-center space-y-1">
              <CheckCircle2 className="h-8 w-8 text-primary mx-auto" />
              <p className="font-heading text-[20px] text-forest">
                {result.success_count} report{result.success_count !== 1 ? "s" : ""} generated
              </p>
              {result.shared_count > 0 && (
                <p className="font-body text-[13px] text-muted-foreground">
                  {result.shared_count} client notification{result.shared_count !== 1 ? "s" : ""} sent
                </p>
              )}
            </div>

            {/* Per-account results */}
            <div className="max-h-[200px] overflow-y-auto border border-border-light rounded-[6px] divide-y divide-border-light">
              {result.results.map(r => (
                <div key={r.account_id} className="flex items-center gap-2 px-3 py-2">
                  {r.success ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                  )}
                  <span className="font-body text-[13px] text-charcoal flex-1 truncate">{r.account_name}</span>
                  {r.success && r.shared_count ? (
                    <span className="font-data text-[11px] text-muted-foreground">
                      {r.shared_count} shared
                    </span>
                  ) : null}
                  {!r.success && (
                    <span className="font-data text-[11px] text-destructive truncate max-w-[120px]">{r.error}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === "config" && (
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={selectedAccounts.size === 0}
              className="bg-verdant text-white hover:bg-verdant/90 font-body text-[13px] font-semibold rounded-[6px]"
            >
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Generate {selectedAccounts.size} Report{selectedAccounts.size !== 1 ? "s" : ""}
            </Button>
          )}
          {phase === "complete" && (
            <Button size="sm" variant="secondary" onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
