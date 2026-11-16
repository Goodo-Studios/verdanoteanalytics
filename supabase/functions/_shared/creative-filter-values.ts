// Distinct product, theme and hook values for the Creatives filter menus (audit plan item 7.3).
// Scoped to the caller's accounts (allowedIds null = staff = every account).
//
// The values come from one RPC, creative_filter_values, which reads every creative. Plain
// selects were capped at 1,000 rows by PostgREST, so most products and themes never reached
// the menus once an account had more creatives than that.
import { distinctValues } from "./creative-filters.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type FilterValues = { product: string[]; theme: string[]; hook: string[] };

function strings(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export async function loadFilterValues(db: Db, allowedIds: string[] | null): Promise<FilterValues> {
  const { data, error } = await db.rpc("creative_filter_values", { p_allowed_ids: allowedIds });
  if (error) throw new Error(error.message ?? "creative_filter_values failed");
  const product = strings(data?.product).filter((v): v is string => typeof v === "string" && v !== "");
  const theme = strings(data?.theme).filter((v): v is string => typeof v === "string" && v !== "");
  return {
    product: [...new Set(product)],
    theme: [...new Set(theme)],
    // Same clean-up as before (trimmed, de-duplicated) for the free-text hook values.
    hook: distinctValues(strings(data?.hook)),
  };
}
