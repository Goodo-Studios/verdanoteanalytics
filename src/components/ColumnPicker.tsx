import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { SlidersHorizontal, GripVertical } from "lucide-react";
import { useState, useRef, useCallback } from "react";

export interface ColumnDef {
  key: string;
  label: string;
  defaultVisible?: boolean;
  group?: string;
}

interface ColumnPickerProps {
  columns: ColumnDef[];
  visibleColumns: Set<string>;
  onToggle: (key: string) => void;
  columnOrder: string[];
  onReorder: (newOrder: string[]) => void;
}

export const ColumnPicker = ({ columns, visibleColumns, onToggle, columnOrder, onReorder }: ColumnPickerProps) => {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);

  // Build ordered list from columnOrder, falling back to columns array order
  const colMap = new Map(columns.map(c => [c.key, c]));
  const orderedKeys = columnOrder.length > 0
    ? columnOrder.filter(k => colMap.has(k))
    : columns.map(c => c.key);
  // Add any missing columns at end
  const allKeys = new Set(orderedKeys);
  columns.forEach(c => { if (!allKeys.has(c.key)) orderedKeys.push(c.key); });

  const orderedCols = orderedKeys.map(k => colMap.get(k)!).filter(Boolean);

  const groups = orderedCols.reduce<Record<string, ColumnDef[]>>((acc, col) => {
    const g = col.group || "Other";
    if (!acc[g]) acc[g] = [];
    acc[g].push(col);
    return acc;
  }, {});

  const groupOrder = ["Core", "Tags", "Performance", "Engagement", "Commerce", "Context"];

  const handleDragStart = useCallback((e: React.DragEvent, key: string) => {
    dragRef.current = key;
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverKey(key);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    const sourceKey = dragRef.current;
    if (!sourceKey || sourceKey === targetKey) {
      setDragKey(null);
      setDragOverKey(null);
      return;
    }
    const newOrder = [...orderedKeys];
    const fromIdx = newOrder.indexOf(sourceKey);
    const toIdx = newOrder.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, sourceKey);
    onReorder(newOrder);
    setDragKey(null);
    setDragOverKey(null);
    dragRef.current = null;
  }, [orderedKeys, onReorder]);

  const handleDragEnd = useCallback(() => {
    setDragKey(null);
    setDragOverKey(null);
    dragRef.current = null;
  }, []);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
          Columns
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card rounded-[8px] shadow-modal p-7">
        <DialogHeader>
          <DialogTitle className="font-heading text-[20px] text-forest">Choose & Order Columns</DialogTitle>
          <DialogDescription className="font-body text-[13px] text-slate font-light">Select data points and drag to reorder them.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          {groupOrder.filter(g => groups[g]).map((groupName, idx) => (
            <div key={groupName} className={idx > 0 ? "mt-5" : ""}>
              <h4 className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-sage mb-2">{groupName}</h4>
              <div className="space-y-0.5">
                {groups[groupName].map((col) => (
                  <div
                    key={col.key}
                    draggable
                    onDragStart={(e) => handleDragStart(e, col.key)}
                    onDragOver={(e) => handleDragOver(e, col.key)}
                    onDrop={(e) => handleDrop(e, col.key)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors select-none ${
                      dragOverKey === col.key && dragKey !== col.key ? "bg-primary/10 border border-primary/30" : "hover:bg-accent"
                    } ${dragKey === col.key ? "opacity-40" : ""}`}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-sage hover:text-slate cursor-grab flex-shrink-0" />
                    <Checkbox
                      checked={visibleColumns.has(col.key)}
                      onCheckedChange={() => onToggle(col.key)}
                      className="border-sage data-[state=unchecked]:bg-transparent"
                    />
                    <span className="font-body text-[13px] font-medium text-charcoal truncate cursor-default flex-1">{col.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
