// Every creative matching the list filters, for the ?all=1 path of the creatives function.
//
// Audit 7.4: ordering by spend alone is not unique (most creatives tie at zero spend), so
// offset pages could skip and repeat rows. ad_id breaks the tie, and the shared fetchAllRows
// keeps reading until an empty page.
// deno-lint-ignore-file no-explicit-any
import { fetchAllRows } from "../_shared/paging.ts";

/**
 * Read every matching creative, highest spend first. `filtered` returns a fresh filtered
 * select (filters applied, no order or range).
 */
export function fetchAllCreatives(filtered: () => any): Promise<any[]> {
  return fetchAllRows<any>((from, to) =>
    filtered()
      .order("spend", { ascending: false })
      .order("ad_id", { ascending: true })
      .range(from, to)
  );
}
