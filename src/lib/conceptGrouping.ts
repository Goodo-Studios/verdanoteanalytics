/**
 * Parse an ad_name into a "concept root" by stripping version/iteration suffixes.
 * E.g. "Summer Sale v2" → "Summer Sale", "Brand Ad (3)" → "Brand Ad"
 */
export function extractConceptRoot(adName: string): string {
  let root = adName.trim();

  // Remove everything after "iteration", "iter", "version" (case-insensitive)
  root = root.replace(/\s*(iteration|iter|version)\b.*/i, "");

  // Remove trailing patterns: v1, V2, (1), (2), - 1, - 2, _v1, _V2, " 1", " 2"
  root = root
    .replace(/[\s_-]*\(?\s*v\d+\s*\)?$/i, "")   // v1, _v2, (v3)
    .replace(/\s*\(\d+\)\s*$/, "")                 // (1), (2)
    .replace(/[\s_-]+\d+\s*$/, "");                // - 1, _ 2, trailing " 3"

  return root.trim() || adName.trim();
}

export interface ConceptGroup {
  name: string;
  iterations: any[];
  totalSpend: number;
  totalPurchases: number;
  blendedRoas: number;
  best: any | null;
  worst: any | null;
}

export function groupByConcept(creatives: any[]): ConceptGroup[] {
  const map = new Map<string, any[]>();

  for (const c of creatives) {
    const root = extractConceptRoot(c.ad_name || "");
    if (!map.has(root)) map.set(root, []);
    map.get(root)!.push(c);
  }

  return Array.from(map.entries())
    .map(([name, iterations]) => {
      const totalSpend = iterations.reduce((s, c) => s + (Number(c.spend) || 0), 0);
      const totalPurchases = iterations.reduce((s, c) => s + (Number(c.purchases) || 0), 0);
      const totalPurchaseValue = iterations.reduce((s, c) => s + (Number(c.purchase_value) || 0), 0);
      const blendedRoas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;

      const withSpend = iterations.filter(c => (Number(c.spend) || 0) > 0);
      const sorted = [...withSpend].sort((a, b) => (Number(b.roas) || 0) - (Number(a.roas) || 0));
      const best = sorted[0] || null;
      const worst = sorted.length > 1 ? sorted[sorted.length - 1] : null;

      return { name, iterations, totalSpend, totalPurchases, blendedRoas, best, worst };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
}
