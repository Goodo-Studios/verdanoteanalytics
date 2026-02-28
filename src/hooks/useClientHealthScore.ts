import { useMemo } from "react";
import { useCreatives } from "@/hooks/useCreatives";
import { useWoWTrends } from "@/hooks/useWoWTrends";
import { useMtdSpend } from "@/hooks/useMtdSpend";

export interface ClientHealthBreakdown {
  performanceTrajectory: number; // 0-20
  creativeVelocity: number;      // 0-20
  clientResponsiveness: number;  // 0-20
  relationshipLength: number;    // 0-20
  growthSignal: number;          // 0-20
  total: number;                 // 0-100
}

export type HealthTier = "green" | "amber" | "red";

export function getHealthTier(score: number): HealthTier {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "red";
}

export function getHealthColor(tier: HealthTier) {
  switch (tier) {
    case "green": return "bg-verdant";
    case "amber": return "bg-gold";
    case "red": return "bg-destructive";
  }
}

export function getHealthLabel(tier: HealthTier) {
  switch (tier) {
    case "green": return "Healthy";
    case "amber": return "Needs Attention";
    case "red": return "At Risk";
  }
}

function responsivenessScore(value: string | null | undefined): number {
  switch (value) {
    case "excellent": return 20;
    case "good": return 15;
    case "slow": return 8;
    case "blocked": return 0;
    default: return 15;
  }
}

function relationshipScore(startDate: string | null | undefined): number {
  if (!startDate) return 10; // default mid-range
  const months = (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months >= 12) return 20;
  if (months >= 6) return 15;
  if (months >= 3) return 10;
  return 5;
}

export function computeClientHealth(
  account: any,
  creatives: any[],
  wowTrends?: Map<string, any>,
  mtdSpend?: number,
): ClientHealthBreakdown {
  const active = creatives.filter((c: any) => (Number(c.spend) || 0) > 0);
  if (active.length === 0) {
    return { performanceTrajectory: 0, creativeVelocity: 0, clientResponsiveness: responsivenessScore(account?.client_responsiveness), relationshipLength: relationshipScore(account?.client_start_date), growthSignal: 0, total: 0 };
  }

  // 1. Performance trajectory (ROAS trend via prior_roas vs roas)
  let trajectoryScore = 10;
  const withPrior = active.filter((c: any) => c.prior_roas != null && c.roas != null);
  if (withPrior.length > 0) {
    let improving = 0;
    for (const c of withPrior) {
      if (Number(c.roas) > Number(c.prior_roas)) improving++;
    }
    const pct = improving / withPrior.length;
    trajectoryScore = Math.round(Math.min(20, pct * 20 * 1.5)); // 67%+ improving = 20
  }

  // 2. Creative velocity: new creatives this month vs target
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const newThisMonth = creatives.filter((c: any) => c.created_at?.startsWith(thisMonth)).length;
  const target = 10; // reasonable default
  const velocityScore = Math.round(Math.min(20, (newThisMonth / target) * 20));

  // 3. Client responsiveness (manual)
  const respScore = responsivenessScore(account?.client_responsiveness);

  // 4. Relationship length
  const relScore = relationshipScore(account?.client_start_date);

  // 5. Growth signal: is spend increasing? Use prior_roas presence as proxy
  let growthScore = 10;
  if (mtdSpend != null && account?.target_monthly_spend) {
    const pacing = mtdSpend / (account.target_monthly_spend * (now.getDate() / 30));
    growthScore = Math.round(Math.min(20, Math.max(0, pacing * 15)));
  } else if (wowTrends && wowTrends.size > 0) {
    // Check spend trends from top spenders
    const sorted = [...active].sort((a: any, b: any) => (Number(b.spend) || 0) - (Number(a.spend) || 0)).slice(0, 10);
    let upCount = 0;
    for (const c of sorted) {
      const t = wowTrends.get(c.ad_id);
      if (t && t.direction === "up") upCount++;
    }
    growthScore = Math.round(Math.min(20, (upCount / Math.max(sorted.length, 1)) * 20));
  }

  const total = Math.min(100, trajectoryScore + velocityScore + respScore + relScore + growthScore);

  return {
    performanceTrajectory: trajectoryScore,
    creativeVelocity: velocityScore,
    clientResponsiveness: respScore,
    relationshipLength: relScore,
    growthSignal: growthScore,
    total,
  };
}

/** Hook to compute client health for a specific account */
export function useClientHealthScore(account: any) {
  const accountId = account?.id;
  const { data: creativesResult } = useCreatives(accountId ? { account_id: accountId } : {});
  const creatives = Array.isArray(creativesResult) ? creativesResult : (creativesResult?.data ?? []);
  const { data: wowTrends } = useWoWTrends(accountId);
  const { data: mtdSpend } = useMtdSpend(accountId);

  return useMemo(
    () => computeClientHealth(account, creatives, wowTrends, mtdSpend),
    [account, creatives, wowTrends, mtdSpend]
  );
}
