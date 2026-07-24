// US-003: Typed client for the session-authed `account-taxonomy` edge function.
//
// In-app UI policy: ALL taxonomy reads/writes go through the first-party,
// session-authed edge function via supabase.functions.invoke — never the
// key-gated external `api` function. The function verifies the session JWT +
// account ownership server-side, then reads through the single
// rpc_account_taxonomy path so every surface sees identical values.
//
// Every action response includes a fresh `taxonomy` payload; the hook layer
// (useAccountTaxonomy) writes it straight into the react-query cache instead
// of invalidating.

import { supabase } from "@/integrations/supabase/client";

/** One Theme/Persona entry (an angle_clusters row) from rpc_account_taxonomy. */
export interface TaxonomyTheme {
  id: string;
  label: string | null;
  theme: string | null;
  summary: string | null;
  /** Provenance: 'manual' | 'csv' | 'csv:<batch_key>' (review mining) | other. */
  origin: string | null;
  test_status: string | null;
  archived: boolean;
  archived_at: string | null;
  score: number | null;
  created_at: string | null;
}

/** One house-menu creative type + this account's activation state. */
export interface TaxonomyCreativeType {
  creative_type_id: string;
  lane: string;
  type_name: string;
  menu_sort_order: number;
  active: boolean;
  activation_id: string | null;
  account_sort_order: number | null;
}

/** The rpc_account_taxonomy jsonb payload, returned verbatim on every action. */
export interface AccountTaxonomy {
  account_id: string;
  themes: TaxonomyTheme[];
  creative_types: TaxonomyCreativeType[];
}

export interface SeedResult {
  source: "none" | "review_mining";
  review_mining_count: number;
  seeded_ids: string[];
  empty: boolean;
}

/** True when a theme's origin denotes review-mining provenance (csv / csv:<batch>). */
export function isReviewMiningOrigin(origin: string | null | undefined): boolean {
  if (typeof origin !== "string") return false;
  return origin === "csv" || origin.startsWith("csv:");
}

async function invokeTaxonomy<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("account-taxonomy", {
    body,
  });
  if (error) {
    // supabase-js nulls data on non-2xx; surface the server error when present.
    throw new Error(error.message ?? "Taxonomy request failed");
  }
  return data as T;
}

export async function fetchTaxonomy(accountId: string): Promise<AccountTaxonomy> {
  const res = await invokeTaxonomy<{ taxonomy: AccountTaxonomy }>({
    account_id: accountId,
    action: "list",
  });
  return res.taxonomy;
}

export async function createTheme(
  accountId: string,
  name: string,
): Promise<{ created: { id: string; label: string }; taxonomy: AccountTaxonomy }> {
  return invokeTaxonomy({ account_id: accountId, action: "create", name });
}

export async function renameTheme(
  accountId: string,
  angleId: string,
  name: string,
): Promise<{ renamed: { id: string; label: string }; taxonomy: AccountTaxonomy }> {
  return invokeTaxonomy({ account_id: accountId, action: "rename", angle_id: angleId, name });
}

export async function setThemeArchived(
  accountId: string,
  angleId: string,
  archived: boolean,
): Promise<{ updated: { id: string; archived_at: string | null }; taxonomy: AccountTaxonomy }> {
  return invokeTaxonomy({
    account_id: accountId,
    action: archived ? "archive" : "unarchive",
    angle_id: angleId,
  });
}

export async function setCreativeTypeActive(
  accountId: string,
  creativeTypeId: string,
  active: boolean,
): Promise<{ activation: { id: string; creative_type_id: string; active: boolean }; taxonomy: AccountTaxonomy }> {
  return invokeTaxonomy({
    account_id: accountId,
    action: "set_creative_type",
    creative_type_id: creativeTypeId,
    active,
  });
}

export async function seedTaxonomy(
  accountId: string,
): Promise<{ seed: SeedResult; taxonomy: AccountTaxonomy }> {
  return invokeTaxonomy({ account_id: accountId, action: "seed" });
}
