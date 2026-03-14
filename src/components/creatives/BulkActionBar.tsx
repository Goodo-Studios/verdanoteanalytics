import { Button } from "@/components/ui/button";
import { Tag, Download, FileText, XCircle } from "lucide-react";

interface BulkActionBarProps {
  count: number;
  onTag: () => void;
  onExport: () => void;
  onAddToReport: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onTag, onExport, onAddToReport, onClear }: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border shadow-lg rounded-xl px-5 py-3"
      style={{ animation: "bulk-bar-in 150ms ease-out both" }}
    >
      <style>{`
        @keyframes bulk-bar-in {
          from { opacity: 0; transform: translate(-50%, 12px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
      <span className="font-data text-[17px] font-semibold text-foreground tabular-nums">
        {count} creative{count !== 1 ? "s" : ""} selected
      </span>
      <div className="w-px h-5 bg-border" />
      <Button size="sm" variant="outline" onClick={onTag} className="gap-1.5">
        <Tag className="h-3.5 w-3.5" />Tag selected
      </Button>
      <Button size="sm" variant="outline" onClick={onExport} className="gap-1.5">
        <Download className="h-3.5 w-3.5" />Export CSV
      </Button>
      <Button size="sm" variant="outline" onClick={onAddToReport} className="gap-1.5">
        <FileText className="h-3.5 w-3.5" />Add to Report
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} className="gap-1.5 text-muted-foreground">
        <XCircle className="h-3.5 w-3.5" />Clear selection
      </Button>
    </div>
  );
}
