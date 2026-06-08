export type OptimizationGoal = 'PURCHASE' | 'SESSION_CONVERSION';

export interface MetricConfig {
  key: string;          // field name on the creatives row
  label: string;        // display label
  format: 'currency' | 'multiplier' | 'integer' | 'percent';
  description?: string;
}

export const OBJECTIVE_CONFIG: Record<OptimizationGoal, {
  primaryMetrics: MetricConfig[];
  outcomeLabel: string;   // e.g. "Purchases" or "Sessions Converted"
  costLabel: string;      // e.g. "CPA" or "Cost / Session"
}> = {
  PURCHASE: {
    primaryMetrics: [
      { key: 'roas',      label: 'ROAS',      format: 'multiplier' },
      { key: 'cpa',       label: 'CPA',       format: 'currency'   },
      { key: 'purchases', label: 'Purchases', format: 'integer'    },
    ],
    outcomeLabel: 'Purchases',
    costLabel: 'CPA',
  },
  SESSION_CONVERSION: {
    primaryMetrics: [
      { key: 'result_count',    label: 'Sessions',          format: 'integer'  },
      { key: 'cost_per_result', label: 'Cost / Session',    format: 'currency' },
    ],
    outcomeLabel: 'Sessions Converted',
    costLabel: 'Cost / Session',
  },
};

export function getObjectiveConfig(goal: string | null | undefined) {
  return OBJECTIVE_CONFIG[(goal as OptimizationGoal) ?? 'PURCHASE'] ?? OBJECTIVE_CONFIG.PURCHASE;
}
