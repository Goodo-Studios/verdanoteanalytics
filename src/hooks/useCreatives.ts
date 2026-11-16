import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { withDisplayTags, withDisplayTagsAll } from "@/lib/tagDisplay";
import { useMutationWithToast } from "./useMutationWithToast";
import { TAG_CHANGE_QUERY_KEYS } from "@/lib/tagRefresh";

const PAGE_SIZE = 100;

export function useCreatives(filters: Record<string, string> = {}, page = 0) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  const qs = params.toString();
  return useQuery<{ data: any[]; total: number; no_daily_data?: boolean }>({
    queryKey: ["creatives", qs],
    queryFn: async () => {
      const result = await apiFetch("creatives", qs ? `?${qs}` : "");
      // Legacy ad_type "Image"/"Photo" display as "Static" (read-side only).
      return result && Array.isArray(result.data)
        ? { ...result, data: withDisplayTagsAll(result.data) }
        : result;
    },
    // Intentionally no keepPreviousData — on account switch, stale cross-account data must not render.
  });
}

export const CREATIVES_PAGE_SIZE = PAGE_SIZE;

export function useCreativeFilters() {
  return useQuery({ queryKey: ["creative-filters"], queryFn: () => apiFetch("creatives", "filters") });
}

/**
 * Path for a tag save. With a single working account the server refuses a creative from another
 * account (audit 3.2); "all" or no account leaves the save unscoped.
 */
export function creativeUpdatePath(adId: string, accountId?: string | null): string {
  return accountId && accountId !== "all" ? `${adId}?account_id=${encodeURIComponent(accountId)}` : adId;
}

export function useUpdateCreative() {
  return useMutationWithToast({
    mutationFn: ({ adId, updates, accountId }: { adId: string; updates: Record<string, any>; accountId?: string | null }) =>
      apiFetch("creatives", creativeUpdatePath(adId, accountId), { method: "PUT", body: JSON.stringify(updates) }).then(withDisplayTags),
    invalidateKeys: TAG_CHANGE_QUERY_KEYS, // every tag screen (audit 5.6)
    successMessage: "Tags updated",
    errorMessage: "Error updating tags",
  });
}

export function useAutoTagPreview() {
  return useMutationWithToast({
    mutationFn: (accountId: string) =>
      apiFetch("creatives", "auto-tag", { method: "POST", body: JSON.stringify({ account_id: accountId, dry_run: true }) }),
    errorMessage: "Failed to preview auto-tags",
  });
}

export function useAutoTagApply() {
  return useMutationWithToast({
    mutationFn: (accountId: string) =>
      apiFetch("creatives", "auto-tag", { method: "POST", body: JSON.stringify({ account_id: accountId }) }),
    invalidateKeys: TAG_CHANGE_QUERY_KEYS, // every tag screen (audit 5.6)
    successMessage: (data: any) => `Auto-tagged ${data.applied} creatives`,
    errorMessage: "Failed to apply auto-tags",
  });
}


/**
 * Distinct hook values actually stored on creatives (hook is free text under
 * the naming convention), for the hook filter dropdown. Scoped to one account
 * when given; RLS limits the rows to the caller's accounts either way. Sorted,
 * exact values — the server-side `hook` filter is an exact match.
 */
export function useDistinctHooks(accountId?: string | null) {
  const scoped = accountId && accountId !== "all" ? accountId : null;
  return useQuery<string[]>({
    queryKey: ["creative-distinct-hooks", scoped ?? "all"],
    queryFn: async () => {
      // PostgREST has no SELECT DISTINCT, and a single capped read of non-distinct rows can
      // fill up with repeats of a few hooks and silently drop the rest. Page through every row
      // (stable order) and de-duplicate client-side. HOOK_PAGE matches the server's row cap.
      const HOOK_PAGE = 1000;
      const MAX_PAGES = 100;
      const seen = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page++) {
        let q = supabase
          .from("creatives")
          .select("hook")
          .not("hook", "is", null)
          .order("hook", { ascending: true })
          .order("ad_id", { ascending: true })
          .range(page * HOOK_PAGE, page * HOOK_PAGE + HOOK_PAGE - 1);
        if (scoped) q = q.eq("account_id", scoped);
        const { data, error } = await q;
        if (error) throw new Error(error.message || "Failed to load hooks");
        const rows = data ?? [];
        for (const r of rows) {
          const h = ((r as { hook: string | null }).hook ?? "").trim();
          if (h) seen.add(h);
        }
        if (rows.length < HOOK_PAGE) break;
      }
      return [...seen].sort((a, b) => a.localeCompare(b));
    },
    staleTime: 5 * 60 * 1000,
  });
}
