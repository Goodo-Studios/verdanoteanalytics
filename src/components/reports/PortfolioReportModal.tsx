import { useState, useCallback } from "react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CalendarIcon, Loader2, Layers } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface PortfolioReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: any[];
}

export function PortfolioReportModal({ open, onOpenChange, accounts }: PortfolioReportModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const lastMonth = subMonths(new Date(), 1);

  const [reportName, setReportName] = useState("Goodo Studios Portfolio Performance Report");
  const [dateStart, setDateStart] = useState<Date>(startOfMonth(lastMonth));
  const [dateEnd, setDateEnd] = useState<Date>(endOfMonth(lastMonth));
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set(accounts.map(a => a.id)));
  const [generating, setGenerating] = useState(false);

  const allSelected = selectedAccounts.size === accounts.length;

  const toggleAll = () => {
    setSelectedAccounts(allSelected ? new Set() : new Set(accounts.map(a => a.id)));
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
    if (accountIds.length < 2) {
      toast.error("Select at least 2 accounts for a portfolio report");
      return;
    }

    setGenerating(true);
    try {
      const data = await apiFetch("reports", "portfolio", {
        method: "POST",
        body: JSON.stringify({
          account_ids: accountIds,
          date_start: format(dateStart, "yyyy-MM-dd"),
          date_end: format(dateEnd, "yyyy-MM-dd"),
          report_name: reportName,
        }),
      });

      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Portfolio report generated");
      onOpenChange(false);
      navigate(`/reports/${data.id}`);
    } catch (err) {
      console.error("Portfolio report error:", err);
      toast.error("Error generating portfolio report");
    } finally {
      setGenerating(false);
    }
  }, [selectedAccounts, dateStart, dateEnd, reportName, queryClient, navigate, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-white rounded-[8px] shadow-modal p-7">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-[22px] text-forest">
            <Layers className="h-5 w-5 text-sage" />
            New Portfolio Report
          </DialogTitle>
          <DialogDescription className="font-body text-[13px] text-slate font-light">
            Generate a cross-account performance report with AI insights.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Report name */}
          <div className="space-y-1.5">
            <Label className="font-body text-[14px] font-medium text-charcoal">Report Name</Label>
            <Input
              className="bg-background font-body text-[14px] text-charcoal border-border-light rounded-[4px]"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
            />
          </div>

          {/* Date Range */}
          <div className="space-y-1.5">
            <Label className="font-body text-[14px] font-medium text-charcoal">Date Range</Label>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("h-9 flex-1 justify-start border-border-light rounded-[4px]", "font-data text-[14px] font-medium text-charcoal")}>
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
                  <Button variant="outline" className={cn("h-9 flex-1 justify-start border-border-light rounded-[4px]", "font-data text-[14px] font-medium text-charcoal")}>
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
        </div>

        <DialogFooter>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={selectedAccounts.size < 2 || generating}
            className="bg-verdant text-white hover:bg-verdant/90 font-body text-[13px] font-semibold rounded-[6px]"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Layers className="h-3.5 w-3.5 mr-1.5" />
            )}
            Generate Portfolio Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
