import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { X, Plus, Trash2 } from "lucide-react";
import { TYPE_OPTIONS, HOOK_OPTIONS } from "@/lib/tagOptions";
import type { Grade } from "@/lib/creativeGrading";


/* ── types ─────────────────────────────────────────── */

export interface AdvancedCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
  valueTo?: string;          // for "between"
  multiValues?: string[];    // for multi-select fields
}

export type AdvancedConditions = AdvancedCondition[];

/* ── field definitions ─────────────────────────────── */

interface FieldDef {
  key: string;
  label: string;
  type: "number" | "multiSelect" | "text";
  operators?: string[];
  options?: string[];
}

const FIELD_DEFS: FieldDef[] = [
  { key: "roas", label: "ROAS", type: "number", operators: ["gt", "lt", "between"] },
  { key: "spend", label: "Spend", type: "number", operators: ["gt", "lt"] },
  { key: "ctr", label: "CTR", type: "number", operators: ["gt", "lt"] },
  { key: "hook_rate", label: "Hook Rate", type: "number", operators: ["gt", "lt"] },
  { key: "cpa", label: "CPA", type: "number", operators: ["gt", "lt"] },
  { key: "grade", label: "Grade", type: "multiSelect", options: ["A", "B", "C", "D", "F"] },
  { key: "format", label: "Format", type: "multiSelect", options: TYPE_OPTIONS },
  { key: "hook_type", label: "Hook Type", type: "multiSelect", options: HOOK_OPTIONS },
  { key: "status", label: "Status", type: "multiSelect", options: ["Scaling", "Monitoring", "Paused", "Losing Momentum", "High Fatigue"] },
  { key: "campaign", label: "Campaign", type: "text" },
  { key: "days_running", label: "Days Running", type: "number", operators: ["gt"] },
];

const OP_LABELS: Record<string, string> = {
  gt: "greater than",
  lt: "less than",
  between: "between",
  contains: "contains",
  is: "is",
};

let _idCounter = 0;
const nextId = () => `ac_${++_idCounter}`;

/* ── panel component ─────────────────────────────── */

interface AdvancedFiltersPanelProps {
  open: boolean;
  onClose: () => void;
  conditions: AdvancedConditions;
  onChange: (conditions: AdvancedConditions) => void;
  accountId?: string | null;
}

export function AdvancedFiltersPanel({ open, onClose, conditions, onChange, accountId }: AdvancedFiltersPanelProps) {
  const addCondition = useCallback(() => {
    const usedFields = new Set(conditions.map(c => c.field));
    const available = FIELD_DEFS.find(f => !usedFields.has(f.key));
    const field = available?.key || FIELD_DEFS[0].key;
    const def = FIELD_DEFS.find(f => f.key === field)!;
    const operator = def.type === "number" ? (def.operators?.[0] || "gt") : def.type === "text" ? "contains" : "is";
    onChange([...conditions, { id: nextId(), field, operator, value: "", multiValues: [] }]);
  }, [conditions, onChange]);

  const updateCondition = useCallback((id: string, patch: Partial<AdvancedCondition>) => {
    onChange(conditions.map(c => c.id === id ? { ...c, ...patch } : c));
  }, [conditions, onChange]);

  const removeCondition = useCallback((id: string) => {
    onChange(conditions.filter(c => c.id !== id));
  }, [conditions, onChange]);

  const clearAll = useCallback(() => onChange([]), [onChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[380px] bg-card border-l border-border shadow-lg flex flex-col"
      style={{ animation: "adv-panel-in 150ms ease-out both" }}>
      <style>{`
        @keyframes adv-panel-in {
          from { opacity: 0; transform: translateX(100%); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-heading text-[16px] text-foreground">Advanced Filters</h3>
        <div className="flex items-center gap-2">
          {conditions.length > 0 && (
            <Button size="sm" variant="ghost" onClick={clearAll} className="text-muted-foreground font-body text-[12px]">
              Clear all
            </Button>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Conditions list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {conditions.length === 0 && (
          <p className="font-body text-[13px] text-muted-foreground text-center py-8">
            No filters applied. Click "Add condition" to get started.
          </p>
        )}

        {conditions.map((cond) => (
          <ConditionRow
            key={cond.id}
            condition={cond}
            onUpdate={(patch) => updateCondition(cond.id, patch)}
            onRemove={() => removeCondition(cond.id)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        <Button size="sm" variant="outline" onClick={addCondition} className="w-full gap-1.5 font-body text-[12px]">
          <Plus className="h-3.5 w-3.5" />Add condition
        </Button>
        
      </div>
    </div>
  );
}

/* ── single condition row ───────────────────────── */

function ConditionRow({ condition, onUpdate, onRemove }: {
  condition: AdvancedCondition;
  onUpdate: (patch: Partial<AdvancedCondition>) => void;
  onRemove: () => void;
}) {
  const def = FIELD_DEFS.find(f => f.key === condition.field);
  if (!def) return null;

  const handleFieldChange = (field: string) => {
    const newDef = FIELD_DEFS.find(f => f.key === field)!;
    const operator = newDef.type === "number" ? (newDef.operators?.[0] || "gt") : newDef.type === "text" ? "contains" : "is";
    onUpdate({ field, operator, value: "", valueTo: "", multiValues: [] });
  };

  return (
    <div className="bg-muted/50 rounded-lg p-3 space-y-2 border border-border/50">
      <div className="flex items-center justify-between">
        <Select value={condition.field} onValueChange={handleFieldChange}>
          <SelectTrigger className="w-[140px] h-7 text-[12px] font-body bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_DEFS.map(f => (
              <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {def.type === "number" && (
        <NumberInput condition={condition} operators={def.operators || ["gt", "lt"]} onUpdate={onUpdate} />
      )}
      {def.type === "multiSelect" && (
        <MultiSelectInput condition={condition} options={def.options || []} onUpdate={onUpdate} />
      )}
      {def.type === "text" && (
        <TextInput condition={condition} onUpdate={onUpdate} />
      )}
    </div>
  );
}

/* ── input types ────────────────────────────────── */

function NumberInput({ condition, operators, onUpdate }: {
  condition: AdvancedCondition;
  operators: string[];
  onUpdate: (patch: Partial<AdvancedCondition>) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={condition.operator} onValueChange={(v) => onUpdate({ operator: v })}>
        <SelectTrigger className="w-[120px] h-7 text-[11px] font-body bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map(op => (
            <SelectItem key={op} value={op}>{OP_LABELS[op]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        value={condition.value}
        onChange={(e) => onUpdate({ value: e.target.value })}
        className="w-20 h-7 text-[12px] font-body bg-background"
        placeholder="0"
      />
      {condition.operator === "between" && (
        <>
          <span className="font-body text-[11px] text-muted-foreground">and</span>
          <Input
            type="number"
            value={condition.valueTo || ""}
            onChange={(e) => onUpdate({ valueTo: e.target.value })}
            className="w-20 h-7 text-[12px] font-body bg-background"
            placeholder="0"
          />
        </>
      )}
    </div>
  );
}

function MultiSelectInput({ condition, options, onUpdate }: {
  condition: AdvancedCondition;
  options: string[];
  onUpdate: (patch: Partial<AdvancedCondition>) => void;
}) {
  const selected = new Set(condition.multiValues || []);
  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val); else next.add(val);
    onUpdate({ multiValues: [...next] });
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => (
        <label key={opt} className="inline-flex items-center gap-1 cursor-pointer">
          <Checkbox
            checked={selected.has(opt)}
            onCheckedChange={() => toggle(opt)}
            className="h-3.5 w-3.5"
          />
          <span className="font-body text-[11px] text-foreground">{opt}</span>
        </label>
      ))}
    </div>
  );
}

function TextInput({ condition, onUpdate }: {
  condition: AdvancedCondition;
  onUpdate: (patch: Partial<AdvancedCondition>) => void;
}) {
  return (
    <Input
      value={condition.value}
      onChange={(e) => onUpdate({ value: e.target.value })}
      className="h-7 text-[12px] font-body bg-background"
      placeholder="Contains…"
    />
  );
}

/* ── client-side filter logic ──────────────────── */

export function applyAdvancedFilters(
  creatives: any[],
  conditions: AdvancedConditions,
  gradeMap: Map<string, { grade: Grade }>,
  fatigueMap: Map<string, { level: string }>,
  wowTrends?: Map<string, any>,
): any[] {
  if (conditions.length === 0) return creatives;

  return creatives.filter(c => {
    for (const cond of conditions) {
      if (!passesCondition(c, cond, gradeMap, fatigueMap, wowTrends)) return false;
    }
    return true;
  });
}

function passesCondition(
  c: any,
  cond: AdvancedCondition,
  gradeMap: Map<string, { grade: Grade }>,
  fatigueMap: Map<string, { level: string }>,
  wowTrends?: Map<string, any>,
): boolean {
  const num = (field: string) => Number(c[field]) || 0;

  switch (cond.field) {
    case "roas": return numCheck(num("roas"), cond);
    case "spend": return numCheck(num("spend"), cond);
    case "ctr": return numCheck(num("ctr"), cond);
    case "hook_rate": return numCheck(num("thumb_stop_rate"), cond);
    case "cpa": return numCheck(num("cpa"), cond);
    case "days_running": {
      // Approximate from created_at
      const created = c.created_at ? new Date(c.created_at) : null;
      if (!created) return false;
      const days = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      return numCheck(days, cond);
    }
    case "grade": {
      const gi = gradeMap.get(c.ad_id);
      if (!gi) return false;
      return (cond.multiValues || []).includes(gi.grade);
    }
    case "format": {
      const adType = c.ad_type || "";
      return (cond.multiValues || []).length === 0 || (cond.multiValues || []).includes(adType);
    }
    case "hook_type": {
      const hook = c.hook || "";
      return (cond.multiValues || []).length === 0 || (cond.multiValues || []).includes(hook);
    }
    case "status": {
      const selected = cond.multiValues || [];
      if (selected.length === 0) return true;
      // Derive status
      const fatigue = fatigueMap.get(c.ad_id);
      const trend = wowTrends?.get(c.ad_id);
      const statuses: string[] = [];
      if (fatigue?.level === "high") statuses.push("High Fatigue");
      if (trend?.direction === "up") statuses.push("Scaling");
      if (trend?.direction === "flat") statuses.push("Monitoring");
      if (trend?.direction === "down") statuses.push("Losing Momentum");
      if (c.ad_status === "PAUSED") statuses.push("Paused");
      return selected.some(s => statuses.includes(s));
    }
    case "campaign": {
      const campaignName = (c.campaign_name || "").toLowerCase();
      return campaignName.includes((cond.value || "").toLowerCase());
    }
    default: return true;
  }
}

function numCheck(val: number, cond: AdvancedCondition): boolean {
  const target = Number(cond.value) || 0;
  switch (cond.operator) {
    case "gt": return val > target;
    case "lt": return val < target;
    case "between": return val >= target && val <= (Number(cond.valueTo) || 0);
    default: return true;
  }
}

/* ── URL serialization ─────────────────────────── */

export function serializeConditions(conditions: AdvancedConditions): string {
  if (conditions.length === 0) return "";
  return JSON.stringify(conditions.map(({ field, operator, value, valueTo, multiValues }) =>
    ({ field, operator, value, valueTo, multiValues })
  ));
}

export function deserializeConditions(raw: string): AdvancedConditions {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as any[];
    return parsed.map((c, i) => ({ ...c, id: `ac_${++_idCounter}` }));
  } catch { return []; }
}

export function countActiveConditions(conditions: AdvancedConditions): number {
  return conditions.filter(c => {
    if (c.multiValues && c.multiValues.length > 0) return true;
    if (c.value) return true;
    return false;
  }).length;
}
