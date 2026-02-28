import { useCallback, useState } from "react";
import { GradeBadge } from "./GradeBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SortableTableHead, type SortConfig } from "@/components/SortableTableHead";
import { TagSourceBadge } from "@/components/TagSourceBadge";
import { InlineTagSelect } from "@/components/InlineTagSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { LayoutGrid } from "lucide-react";
import { HEAD_LABELS, NUMERIC_COLS, fmt, CELL_CONFIG, MOBILE_HIDDEN_COLS } from "./constants";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import { cn } from "@/lib/utils";
import { RoasTrendArrow } from "./RoasTrendArrow";
import type { WoWTrend } from "@/hooks/useWoWTrends";
import type { GradeInfo } from "@/lib/creativeGrading";

interface CreativesTableProps {
  creatives: any[];
  visibleCols: Set<string>;
  columnOrder: string[];
  sort: SortConfig;
  onSort: (key: string) => void;
  onReorder: (newOrder: string[]) => void;
  onSelect: (creative: any) => void;
  compareMode?: boolean;
  compareIds?: Set<string>;
  wowTrends?: Map<string, WoWTrend>;
  gradeMap?: Map<string, GradeInfo>;
  bulkSelectedIds?: Set<string>;
  onBulkToggle?: (adId: string) => void;
  onBulkToggleAll?: () => void;
}

const TAG_SELECT_FIELDS: Record<string, "ad_type" | "person" | "style" | "hook"> = {
  type: "ad_type", person: "person", style: "style", hook: "hook",
};

function CreativeCell({ c }: { c: any }) {
  const { url, isLoading } = useCachedMedia(c.thumbnail_url);

  return (
    <div className="flex items-center gap-2.5 max-w-[280px]">
      <div className="h-10 w-10 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
        {c.thumbnail_url ? (
          <img
            src={url}
            alt=""
            className={`h-full w-full object-cover transition-opacity duration-200 ${isLoading ? "opacity-0" : "opacity-100"}`}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0">
        <div className="font-body text-[13px] font-medium text-charcoal truncate">{c.ad_name}</div>
        <div className="font-body text-[11px] text-sage">{c.unique_code}</div>
      </div>
    </div>
  );
}

function renderCell(c: any, key: string, wowTrends?: Map<string, WoWTrend>, gradeMap?: Map<string, GradeInfo>) {
  const mobileHide = MOBILE_HIDDEN_COLS.has(key) ? "hidden sm:table-cell" : "";
  if (key === "creative") return <TableCell key={key}><CreativeCell c={c} /></TableCell>;
  if (key === "grade") {
    const gi = gradeMap?.get(c.ad_id);
    return <TableCell key={key} className={`text-center ${mobileHide}`}>{gi ? <GradeBadge grade={gi.grade} /> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>;
  }
  if (key === "tags") return <TableCell key={key} className={mobileHide}><TagSourceBadge source={c.tag_source} /></TableCell>;
  if (key in TAG_SELECT_FIELDS) {
    const field = TAG_SELECT_FIELDS[key];
    return <TableCell key={key} className={mobileHide}><InlineTagSelect adId={c.ad_id} field={field} currentValue={c[field]} /></TableCell>;
  }

  const cfg = CELL_CONFIG[key];
  if (cfg) {
    const value = c[cfg.field];
    if (cfg.format) {
      const isRoas = cfg.field === "roas";
      return (
        <TableCell key={key} className={`text-right font-data text-[13px] font-medium text-charcoal tabular-nums ${mobileHide}`}>
          <span className="inline-flex items-center gap-0.5 justify-end">
            {fmt(value, cfg.format.prefix, cfg.format.suffix, cfg.format.decimals)}
            {isRoas && <RoasTrendArrow trend={wowTrends?.get(c.ad_id)} />}
          </span>
        </TableCell>
      );
    }
    return <TableCell key={key} className={`text-xs ${cfg.truncate ? "truncate max-w-[150px]" : ""} ${mobileHide}`}>{value || "—"}</TableCell>;
  }

  return null;
}

export function CreativesTable({
  creatives, visibleCols, columnOrder, sort, onSort, onReorder, onSelect,
  compareMode = false, compareIds = new Set(), wowTrends, gradeMap,
  bulkSelectedIds, onBulkToggle, onBulkToggleAll,
}: CreativesTableProps) {
  const bulkMode = !!bulkSelectedIds && !!onBulkToggle;
  const allSelected = bulkMode && creatives.length > 0 && creatives.every((c: any) => bulkSelectedIds!.has(c.ad_id));
  const [dragSourceKey, setDragSourceKey] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);

  const handleColumnDrop = useCallback((targetKey: string) => {
    if (dragSourceKey && dragSourceKey !== targetKey) {
      const newOrder = [...columnOrder];
      const fromIdx = newOrder.indexOf(dragSourceKey);
      const toIdx = newOrder.indexOf(targetKey);
      if (fromIdx !== -1 && toIdx !== -1) {
        newOrder.splice(fromIdx, 1);
        newOrder.splice(toIdx, 0, dragSourceKey);
        onReorder(newOrder);
      }
    }
    setDragSourceKey(null);
    setDragTargetKey(null);
  }, [dragSourceKey, columnOrder, onReorder]);

  const renderHead = (key: string) => {
    if (!visibleCols.has(key)) return null;
    const mobileHide = MOBILE_HIDDEN_COLS.has(key) ? "hidden sm:table-cell" : "";
    if (key === "tags") return <TableHead key={key} className={`font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold ${mobileHide}`}>Tags</TableHead>;
    return (
      <SortableTableHead
        key={key}
        label={HEAD_LABELS[key] || key}
        sortKey={key}
        currentSort={sort}
        onSort={onSort}
        className={`${NUMERIC_COLS.has(key) ? "text-right" : ""} ${mobileHide}`}
        draggable
        onDragStart={setDragSourceKey}
        onDragOver={(_e: React.DragEvent, k: string) => setDragTargetKey(k)}
        onDrop={handleColumnDrop}
        isDragTarget={dragTargetKey === key && dragSourceKey !== key}
      />
    );
  };

  return (
    <div className="glass-panel overflow-x-auto -mx-4 sm:mx-0">
      <Table className="min-w-[700px]">
        <TableHeader>
         <TableRow className="bg-cream-dark">
            {bulkMode && !compareMode && (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => onBulkToggleAll?.()}
                  className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
              </TableHead>
            )}
            {compareMode && <TableHead className="w-10" />}
            {columnOrder.filter(k => visibleCols.has(k)).map(renderHead)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {creatives.map((c: any) => {
            const isSelected = compareIds.has(c.ad_id);
            const isDisabled = compareMode && !isSelected && compareIds.size >= 3;
            const isBulkSelected = bulkMode && bulkSelectedIds!.has(c.ad_id);
            return (
              <TableRow
                key={c.ad_id}
                className={cn(
                  "cursor-pointer hover:bg-accent/50 border-b border-border-light",
                  compareMode && isSelected && "bg-sage-light/50 border-l-[3px] border-l-verdant",
                  isDisabled && "opacity-50 cursor-not-allowed",
                  isBulkSelected && "bg-accent/30"
                )}
                onClick={() => !isDisabled && onSelect(c)}
              >
                {bulkMode && !compareMode && (
                  <TableCell className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isBulkSelected}
                      onCheckedChange={() => onBulkToggle!(c.ad_id)}
                      className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                  </TableCell>
                )}
                {compareMode && (
                  <TableCell className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      disabled={isDisabled}
                      onCheckedChange={() => !isDisabled && onSelect(c)}
                      className="data-[state=checked]:bg-verdant data-[state=checked]:border-verdant"
                    />
                  </TableCell>
                )}
                {columnOrder.filter(k => visibleCols.has(k)).map(key => renderCell(c, key, wowTrends, gradeMap))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
