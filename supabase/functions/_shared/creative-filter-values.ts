// Distinct product, theme and hook values for the Creatives filter menus (audit plan item 7.3).
// Scoped to the caller's accounts (allowedIds null = staff = every account).
import { distinctValues } from "./creative-filters.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type FilterValues = { product: string[]; theme: string[]; hook: string[] };

export async function loadFilterValues(db: Db, allowedIds: string[] | null): Promise<FilterValues> {
  let productsQuery = db.from("creatives").select("product").not("product", "is", null);
  let themesQuery = db.from("creatives").select("theme").not("theme", "is", null);
  if (allowedIds) {
    productsQuery = productsQuery.in("account_id", allowedIds);
    themesQuery = themesQuery.in("account_id", allowedIds);
  }
  const { data: products } = await productsQuery;
  const { data: themes } = await themesQuery;

  // Hooks are free text in the naming convention, so the option list is the distinct hook
  // values actually stored for the caller's accounts. Paged: one PostgREST select is capped at
  // 1000 rows; bounded at 50 pages so this stays cheap.
  const hookValues: unknown[] = [];
  for (let page = 0; page < 50; page++) {
    let hooksQuery = db.from("creatives").select("hook").not("hook", "is", null)
      .order("hook").range(page * 1000, page * 1000 + 999);
    if (allowedIds) hooksQuery = hooksQuery.in("account_id", allowedIds);
    const { data: hookRows, error: hooksErr } = await hooksQuery;
    if (hooksErr) throw hooksErr;
    hookValues.push(...(hookRows || []).map((r: { hook: string | null }) => r.hook));
    if (!hookRows || hookRows.length < 1000) break;
  }

  return {
    // deno-lint-ignore no-explicit-any
    product: [...new Set((products || []).map((r: any) => r.product).filter(Boolean))] as string[],
    // deno-lint-ignore no-explicit-any
    theme: [...new Set((themes || []).map((r: any) => r.theme).filter(Boolean))] as string[],
    hook: distinctValues(hookValues),
  };
}
