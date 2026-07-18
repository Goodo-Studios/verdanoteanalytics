// resolve-destinations — Creative Intelligence WS2 (US-004).
//
// Classifies each of an account's unique landing destinations (product |
// collection | homepage | lead-form | other) and extracts a product identity,
// then upserts one shared row per destination into landing_destinations. Every ad
// pointing at the same page inherits the same resolution (join by
// account_id + destination_key). Feeds the product tag suggestion (US-008) and a
// same-destination signal for entity resolution (US-006).
//
// Classification is PATH-ONLY (cheap, deterministic, no network) via
// _shared/classify-destination.ts. An OPTIONAL, cached, polite og:title fetch
// (fetch_titles=true) only REFINES the product name for product/collection pages;
// it is off by default so a normal run makes zero external requests.
//
// Auth: internal/service-role only (verify_jwt=false). Body:
//   { account_id: string (required), limit?: number, fetch_titles?: bool, force?: bool }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { classifyDestination, productNameFromTitle } from "../_shared/classify-destination.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Polite, bounded page-title fetch. Returns og:title (preferred) or <title>, or
// null on any failure / non-HTML / timeout. One fetch per destination (cached).
async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    const html = (await res.text()).slice(0, 200_000);
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (og?.[1]) return og[1].trim();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return title?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const accountId: string | undefined = body.account_id;
  if (!accountId) return json({ error: "account_id required" }, 400);
  const limit = Math.min(Math.max(Number(body.limit) || 2000, 1), 5000);
  const fetchTitles: boolean = body.fetch_titles === true;
  const force: boolean = body.force === true;

  const { data: dests, error } = await db.rpc("distinct_destinations", {
    p_account_id: accountId,
    p_limit: limit,
  });
  if (error) return json({ error: error.message }, 500);
  const rows = (dests ?? []) as { destination_key: string; sample_url: string | null }[];
  if (!rows.length) return json({ ok: true, account_id: accountId, total: 0, resolved: 0 });

  // Skip already-resolved destinations unless forcing or a title refinement is
  // requested for one that has none yet (path classification is deterministic).
  let existing = new Map<string, string | null>();
  if (!force) {
    const { data: ex } = await db
      .from("landing_destinations")
      .select("destination_key, page_title")
      .eq("account_id", accountId);
    existing = new Map((ex ?? []).map((r: { destination_key: string; page_title: string | null }) => [r.destination_key, r.page_title]));
  }

  const byType: Record<string, number> = {};
  let resolved = 0;
  let skipped = 0;
  let titlesFetched = 0;
  const errors: string[] = [];

  for (const r of rows) {
    const key = r.destination_key;
    const hasPrior = existing.has(key);
    const priorTitle = existing.get(key) ?? null;
    if (!force && hasPrior && (!fetchTitles || priorTitle)) {
      skipped++;
      continue;
    }

    const c = classifyDestination(key);
    let product = c.product;
    let pageTitle: string | null = priorTitle;

    if (fetchTitles && (c.type === "product" || c.type === "collection") && (force || !pageTitle)) {
      const t = await fetchPageTitle(key);
      if (t) {
        pageTitle = t;
        titlesFetched++;
        const refined = productNameFromTitle(t);
        if (refined && c.type === "product") product = refined;
      }
    }

    const { error: upErr } = await db.from("landing_destinations").upsert(
      {
        account_id: accountId,
        destination_key: key,
        destination_type: c.type,
        destination_product: product,
        product_slug: c.productSlug,
        page_title: pageTitle,
        sample_url: r.sample_url,
        resolved_at: new Date().toISOString(),
      },
      { onConflict: "account_id,destination_key" },
    );
    if (upErr) {
      errors.push(`${key}: ${upErr.message}`);
      continue;
    }
    byType[c.type] = (byType[c.type] ?? 0) + 1;
    resolved++;
  }

  return json({
    ok: true,
    account_id: accountId,
    total: rows.length,
    resolved,
    skipped,
    titles_fetched: titlesFetched,
    by_type: byType,
    errors: errors.slice(0, 20),
    error_count: errors.length,
  });
});
