import { Button } from "@/components/ui/button";
import { Tag, Download, X } from "lucide-react";

interface BulkActionBarProps {
  count: number;
  onTag: () => void;
  onExport: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onTag, onExport, onClear }: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border shadow-lg rounded-xl px-5 py-3 animate-in slide-in-from-bottom-4 duration-200">
      <span className="font-data text-[14px] font-semibold text-foreground tabular-nums">
        {count} creative{count !== 1 ? "s" : ""} selected
      </span>
      <div className="w-px h-5 bg-border" />
      <Button size="sm" variant="outline" onClick={onTag} className="gap-1.5">
        <Tag className="h-3.5 w-3.5" />Tag selected
      </Button>
      <Button size="sm" variant="outline" onClick={onExport} className="gap-1.5">
        <Download className="h-3.5 w-3.5" />Export CSV
      </Button>
      <button onClick={onClear} className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
