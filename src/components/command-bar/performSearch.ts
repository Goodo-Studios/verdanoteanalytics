import { supabase } from "@/integrations/supabase/client";
import { gradeCreatives } from "@/lib/creativeGrading";
import { CATEGORY_CONFIG } from "./constants";
import type { GroupedResults } from "./types";

export async function performSearch(query: string, accountId?: string): Promise<GroupedResults[]> {
  const ilike = `%${query}%`;
  const accountFilter = accountId && accountId !== "all" ? accountId : undefined;

  const [creativesRes, reportsRes, briefsRes, creatorsRes, testsRes] = await Promise.all([
    (() => {
      let q = supabase.from("creatives")
        .select("ad_id, ad_name, campaign_name, adset_name, account_id, roas, spend, ctr, thumbnail_url")
        .or(`ad_name.ilike.${ilike},campaign_name.ilike.${ilike},adset_name.ilike.${ilike}`)
        .order("spend", { ascending: false }).limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
    (() => {
      let q = supabase.from("reports")
        .select("id, report_name, account_id, created_at, is_public")
        .ilike("report_name", ilike).order("created_at", { ascending: false }).limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
    (() => {
      let q = supabase.from("briefs")
        .select("id, name, account_id, assignee_name, status")
        .ilike("name", ilike).order("created_at", { ascending: false }).limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
    (() => {
      let q = supabase.from("creators")
        .select("id, name, handle, type, account_id")
        .or(`name.ilike.${ilike},handle.ilike.${ilike}`).order("name").limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
    (() => {
      let q = supabase.from("split_tests")
        .select("id, name, hypothesis, status, variable_tested, account_id")
        .or(`name.ilike.${ilike},hypothesis.ilike.${ilike}`).order("created_at", { ascending: false }).limit(20);
      if (accountFilter) q = q.eq("account_id", accountFilter);
      return q;
    })(),
  ]);

  const creatives = creativesRes.data || [];
  const grades = gradeCreatives(creatives);

  // Build concept groups from creative results
  const conceptMap = new Map<string, { name: string; count: number; totalSpend: number; bestRoas: number }>();
  for (const c of creatives) {
    const root = c.ad_name.replace(/[\s_-]*\(?\s*v\d+\s*\)?$/i, "").replace(/\s*\(\d+\)\s*$/, "").replace(/[\s_-]+\d+\s*$/, "").trim() || c.ad_name;
    const existing = conceptMap.get(root);
    if (existing) {
      existing.count++;
      existing.totalSpend += Number(c.spend) || 0;
      existing.bestRoas = Math.max(existing.bestRoas, Number(c.roas) || 0);
    } else {
      conceptMap.set(root, { name: root, count: 1, totalSpend: Number(c.spend) || 0, bestRoas: Number(c.roas) || 0 });
    }
  }
  const concepts = [...conceptMap.values()].filter(c => c.count > 1).sort((a, b) => b.totalSpend - a.totalSpend);

  const groups: GroupedResults[] = [
    {
      category: "creatives", ...CATEGORY_CONFIG.creatives, total: creatives.length,
      results: creatives.map(c => {
        const g = grades.get(c.ad_id);
        return {
          id: c.ad_id, category: "creatives" as const, title: c.ad_name,
          subtitle: [c.campaign_name, c.adset_name].filter(Boolean).join(" · "),
          meta: c.roas != null ? `${Number(c.roas).toFixed(2)}x` : undefined,
          thumbnail: c.thumbnail_url, grade: g?.grade, roas: Number(c.roas) || 0,
          navigateTo: "/creatives", searchParams: { q: c.ad_name },
        };
      }),
    },
    {
      category: "concepts", ...CATEGORY_CONFIG.concepts, total: concepts.length,
      results: concepts.slice(0, 5).map(c => ({
        id: `concept-${c.name}`, category: "concepts" as const, title: c.name,
        subtitle: `${c.count} iterations`,
        meta: `${c.bestRoas.toFixed(2)}x best`,
        navigateTo: "/creatives", searchParams: { q: c.name },
      })),
    },
    {
      category: "reports", ...CATEGORY_CONFIG.reports, total: (reportsRes.data || []).length,
      results: (reportsRes.data || []).map(r => ({
        id: r.id, category: "reports" as const, title: r.report_name,
        subtitle: r.account_id || undefined,
        meta: new Date(r.created_at).toLocaleDateString(), navigateTo: `/reports/${r.id}`,
      })),
    },
    {
      category: "briefs", ...CATEGORY_CONFIG.briefs, total: (briefsRes.data || []).length,
      results: (briefsRes.data || []).map(b => ({
        id: b.id, category: "briefs" as const, title: b.name,
        subtitle: [b.assignee_name, b.status].filter(Boolean).join(" · "),
        navigateTo: "/briefs", searchParams: { q: b.name },
      })),
    },
    {
      category: "creators", ...CATEGORY_CONFIG.creators, total: (creatorsRes.data || []).length,
      results: (creatorsRes.data || []).map(c => ({
        id: c.id, category: "creators" as const, title: c.name,
        subtitle: [c.handle, c.type].filter(Boolean).join(" · "),
        navigateTo: "/creators", searchParams: { q: c.name },
      })),
    },
    {
      category: "tests", ...CATEGORY_CONFIG.tests, total: (testsRes.data || []).length,
      results: (testsRes.data || []).map(t => ({
        id: t.id, category: "tests" as const, title: t.name,
        subtitle: [t.variable_tested, t.status].filter(Boolean).join(" · "),
        navigateTo: "/tests", searchParams: { q: t.name },
      })),
    },
  ];

  return groups.filter(g => g.results.length > 0);
}
