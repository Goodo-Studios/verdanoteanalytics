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
import { getObjectiveConfig } from "@/lib/objectiveConfig";

// Columns that only make sense for PURCHASE accounts
const PURCHASE_ONLY_COLS = new Set(["roas", "cpa", "purchases"]);
// Columns that only make sense for SESSION_CONVERSION accounts
const SESSION_ONLY_COLS = new Set(["result_count", "cost_per_result"]);

// Extra CELL_CONFIG entries for session-conversion columns (not in constants.ts)
const SESSION_CELL_CONFIG: Record<string, { field: string; format?: { prefix?: string; suffix?: string; decimals?: number } }> = {
  result_count:    { field: "result_count",    format: { decimals: 0 } },
  cost_per_result: { field: "cost_per_result", format: { prefix: "$" } },
};

interface CreativesTableProps {
  creatives: any[];
  visibleCols: Set<string>;
  columnOrder: string[];
  sort: SortConfig;
  onSort: (key: string) => void;
  onReorder: (newOrder: string[]) => void;
  onSelect: (creative: any) => void;
  wowTrends?: Map<string, WoWTrend>;
  gradeMap?: Map<string, GradeInfo>;
  bulkSelectedIds?: Set<string>;
  onBulkToggle?: (adId: string) => void;
  onBulkToggleAll?: () => void;
  optimizationGoal?: string;
}

const TAG_SELECT_FIELDS: Record<string, "ad_type" | "person" | "style" | "hook"> = {
  type: "ad_type", person: "person", style: "style", hook: "hook",
};

function CreativeCell({ c }: { c: any }) {
  const { url, isLoading } = useCachedMedia(c.thumbnail_url);

  return (
    <div className="flex items-center gap-2.5 max-w-[280px]">
      <div className="h-10 w-10 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
        {c.thumbnail_url && c.thumbnail_url !== "no-thumbnail" ? (
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
        <div className="font-body text-[11px] text-sage truncate">{c.unique_code}</div>
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

  // Session-conversion columns not in CELL_CONFIG — handle inline
  const sessionCfg = SESSION_CELL_CONFIG[key];
  if (sessionCfg) {
    const value = c[sessionCfg.field];
    return (
      <TableCell key={key} className={`text-right font-data text-[17px] font-medium text-charcoal tabular-nums ${mobileHide}`}>
        {fmt(value, sessionCfg.format?.prefix, sessionCfg.format?.suffix, sessionCfg.format?.decimals)}
      </TableCell>
    );
  }

  const cfg = CELL_CONFIG[key];
  if (cfg) {
    const value = c[cfg.field];
    if (cfg.format) {
      const isRoas = cfg.field === "roas";
      return (
        <TableCell key={key} className={`text-right font-data text-[17px] font-medium text-charcoal tabular-nums ${mobileHide}`}>
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
  wowTrends, gradeMap,
  bulkSelectedIds, onBulkToggle, onBulkToggleAll,
  optimizationGoal,
}: CreativesTableProps) {
  const objCfg = getObjectiveConfig(optimizationGoal);
  const isSessionGoal = (optimizationGoal ?? 'PURCHASE') === 'SESSION_CONVERSION';

  // Build the effective visible cols and column order based on the objective.
  // For SESSION_CONVERSION: hide PURCHASE-only cols, inject session cols.
  // For PURCHASE (default): hide SESSION-only cols (they won't be in columnOrder anyway).
  const effectiveVisibleCols = new Set(visibleCols);
  const effectiveColumnOrder = [...columnOrder];

  if (isSessionGoal) {
    // Remove purchase-only columns from visibility
    for (const col of PURCHASE_ONLY_COLS) effectiveVisibleCols.delete(col);
    // Inject session columns after 'spend' if not already present
    const sessionCols = objCfg.primaryMetrics.map(m => m.key);
    for (const col of sessionCols) {
      effectiveVisibleCols.add(col);
      if (!effectiveColumnOrder.includes(col)) {
        const spendIdx = effectiveColumnOrder.indexOf("spend");
        effectiveColumnOrder.splice(spendIdx >= 0 ? spendIdx + 1 : effectiveColumnOrder.length, 0, col);
      }
    }
  } else {
    // Remove session-only columns
    for (const col of SESSION_ONLY_COLS) effectiveVisibleCols.delete(col);
  }

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

  // Extended head labels for session columns
  const sessionHeadLabels: Record<string, string> = {
    result_count: "Sessions",
    cost_per_result: "Cost / Session",
  };

  const renderHead = (key: string) => {
    if (!effectiveVisibleCols.has(key)) return null;
    const mobileHide = MOBILE_HIDDEN_COLS.has(key) ? "hidden sm:table-cell" : "";
    if (key === "tags") return <TableHead key={key} className={`font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold ${mobileHide}`}>Tags</TableHead>;
    return (
      <SortableTableHead
        key={key}
        label={sessionHeadLabels[key] || HEAD_LABELS[key] || key}
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
    <div
      className="glass-panel overflow-x-auto -mx-4 sm:mx-0"
      style={{ height: "600px", overflowY: "auto" }}
    >
      <Table className="min-w-[700px]">
        <TableHeader>
         <TableRow className="bg-cream-dark">
            {bulkMode && (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => onBulkToggleAll?.()}
                  className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
              </TableHead>
            )}
            {effectiveColumnOrder.filter(k => effectiveVisibleCols.has(k)).map(renderHead)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {creatives.map((c) => {
            const isBulkSelected = bulkMode && bulkSelectedIds!.has(c.ad_id);
            return (
              <TableRow
                key={c.ad_id}
                className={cn(
                  "cursor-pointer hover:bg-accent/50 border-b border-border-light",
                  isBulkSelected && "bg-accent/30"
                )}
                onClick={() => onSelect(c)}
              >
                {bulkMode && (
                  <TableCell className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isBulkSelected}
                      onCheckedChange={() => onBulkToggle!(c.ad_id)}
                      className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                  </TableCell>
                )}
                {effectiveColumnOrder.filter(k => effectiveVisibleCols.has(k)).map(key => renderCell(c, key, wowTrends, gradeMap))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
