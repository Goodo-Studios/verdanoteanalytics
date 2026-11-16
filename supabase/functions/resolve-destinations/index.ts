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
// Auth: internal/service-role only. NOTE verify_jwt=false means the Supabase
// gateway does NOT enforce that — requireServiceRole() in the handler does.
// Body:
//   { account_id: string (required), limit?: number, fetch_titles?: bool, force?: bool }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import { classifyDestination, productNameFromTitle } from "../_shared/classify-destination.ts";
import { assertPublicNetworkTarget } from "../_shared/public-url.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      chunks.push(value.byteLength <= remaining ? value : value.subarray(0, remaining));
      total += Math.min(value.byteLength, remaining);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

// Polite, bounded page-title fetch. Returns og:title (preferred) or <title>, or
// null on any failure / non-HTML / timeout. One fetch per destination (cached).
async function fetchPageTitle(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    let current = await assertPublicNetworkTarget(url);
    let res: Response | null = null;
    for (let redirects = 0; redirects <= 3; redirects++) {
      res = await fetch(current, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        signal: ctrl.signal,
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location || redirects === 3) return null;
      current = await assertPublicNetworkTarget(new URL(location, current).href);
    }
    if (!res) return null;
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    const html = await readBoundedText(res, 200_000);
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (og?.[1]) return og[1].trim();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return title?.[1]?.trim() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveOptions {
  accountId: string;
  limit?: number;
  fetchTitles?: boolean;
  force?: boolean;
}

export async function resolveAccountDestinations(
  db: Db,
  opts: ResolveOptions,
  deps: { fetchTitle?: (url: string) => Promise<string | null> } = {},
) {
  const accountId = opts.accountId;
  const limit = Math.min(Math.max(Number(opts.limit) || 2000, 1), 5000);
  const fetchTitles = opts.fetchTitles === true;
  const force = opts.force === true;
  const fetchTitle = deps.fetchTitle ?? fetchPageTitle;

  const { data: dests, error } = await db.rpc("distinct_destinations", {
    p_account_id: accountId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const rows = (dests ?? []) as { destination_key: string; sample_url: string | null }[];
  if (!rows.length) return { ok: true, account_id: accountId, total: 0, resolved: 0, skipped: 0 };

  // Stored rows, read in pages of 1,000 (an unpaged select stops at 1,000, and every
  // destination past that looked new and got a null title). Read on forced runs too,
  // so a run never writes null over a stored title (audit 5.10).
  const existing = new Map<string, string | null>();
  for (let from = 0; ; from += 1000) {
    const { data: page, error: exErr } = await db
      .from("landing_destinations")
      .select("destination_key, page_title")
      .eq("account_id", accountId)
      .order("destination_key")
      .range(from, from + 999);
    if (exErr) throw new Error(exErr.message);
    for (const r of (page ?? []) as { destination_key: string; page_title: string | null }[]) {
      existing.set(r.destination_key, r.page_title);
    }
    if (!page || page.length < 1000) break;
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
      const t = await fetchTitle(key);
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

  return {
    ok: true,
    account_id: accountId,
    total: rows.length,
    resolved,
    skipped,
    titles_fetched: titlesFetched,
    by_type: byType,
    errors: errors.slice(0, 20),
    error_count: errors.length,
  };
}

export async function handler(req: Request): Promise<Response> {
  // verify_jwt = false: the Supabase gateway does NOT authenticate this endpoint,
  // so this check is the only gate. Live pg_cron jobs and function-to-function
  // calls forward the real service-role key. See _shared/internal-auth.ts.
  const authFailure = await requireServiceRole(req);
  if (authFailure) return authFailure;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const accountId: string | undefined = body.account_id;
  if (!accountId) return json({ error: "account_id required" }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    return json(await resolveAccountDestinations(db, {
      accountId,
      limit: body.limit,
      fetchTitles: body.fetch_titles === true,
      force: body.force === true,
    }));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

// Tests import resolveAccountDestinations with RESOLVE_DESTINATIONS_NO_SERVE set.
if (!Deno.env.get("RESOLVE_DESTINATIONS_NO_SERVE")) {
  Deno.serve(handler);
}
