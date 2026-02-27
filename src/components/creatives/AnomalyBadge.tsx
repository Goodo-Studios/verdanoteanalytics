import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Zap, ChevronRight } from "lucide-react";
import type { Anomaly, AnomalyCategory } from "@/lib/anomalyDetection";
import { cn } from "@/lib/utils";

interface AnomalyBadgeProps {
  anomalies: Anomaly[];
  onViewCreative?: (adId: string) => void;
}

const CATEGORY_LABELS: Record<AnomalyCategory, string> = {
  urgent: "Urgent",
  opportunity: "Opportunity",
  watch: "Watch",
};

const CATEGORY_COLORS: Record<AnomalyCategory, string> = {
  urgent: "bg-destructive/10 text-destructive border-destructive/20",
  opportunity: "bg-emerald-50 text-emerald-700 border-emerald-200",
  watch: "bg-amber-50 text-amber-700 border-amber-200",
};

export function AnomalyBadge({ anomalies, onViewCreative }: AnomalyBadgeProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  if (anomalies.length === 0) return null;

  const urgentCount = anomalies.filter((a) => a.category === "urgent").length;
  const badgeColor = urgentCount > 0
    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    : "bg-amber-500 text-white hover:bg-amber-600";

  const grouped: Record<AnomalyCategory, Anomaly[]> = {
    urgent: anomalies.filter((a) => a.category === "urgent"),
    opportunity: anomalies.filter((a) => a.category === "opportunity"),
    watch: anomalies.filter((a) => a.category === "watch"),
  };

  return (
    <>
      <button
        onClick={() => setPanelOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-body text-[12px] font-semibold transition-colors",
          badgeColor,
        )}
      >
        <Zap className="h-3 w-3" />
        {anomalies.length} anomal{anomalies.length === 1 ? "y" : "ies"}
      </button>

      {/* Slide-out panel */}
      {panelOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={() => setPanelOpen(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white border-l border-border-light shadow-modal overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-border-light px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="font-heading text-[18px] text-forest">Anomaly Detection</h2>
                <p className="font-body text-[12px] text-muted-foreground mt-0.5">
                  {anomalies.length} pattern{anomalies.length !== 1 ? "s" : ""} detected in your data
                </p>
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {(["urgent", "opportunity", "watch"] as AnomalyCategory[]).map((cat) => {
                const items = grouped[cat];
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[14px]">
                        {cat === "urgent" ? "🔴" : cat === "opportunity" ? "🟢" : "⚠️"}
                      </span>
                      <h3 className="font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {CATEGORY_LABELS[cat]}
                      </h3>
                      <span className="font-data text-[10px] text-muted-foreground bg-muted rounded-full px-1.5">
                        {items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((anomaly, i) => (
                        <div
                          key={`${anomaly.adId}-${anomaly.type}-${i}`}
                          className={cn(
                            "rounded-lg border p-3 space-y-1.5",
                            CATEGORY_COLORS[anomaly.category],
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-body text-[13px] font-semibold truncate">
                                {anomaly.icon} {anomaly.adName}
                              </p>
                              <p className="font-label text-[9px] uppercase tracking-wider opacity-70 mt-0.5">
                                {anomaly.type.replace(/_/g, " ")}
                              </p>
                            </div>
                            {onViewCreative && (
                              <button
                                onClick={() => {
                                  onViewCreative(anomaly.adId);
                                  setPanelOpen(false);
                                }}
                                className="shrink-0 p-1 rounded hover:bg-black/5 transition-colors"
                                title="View creative"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          <p className="font-body text-[12px] leading-relaxed opacity-90">
                            {anomaly.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
