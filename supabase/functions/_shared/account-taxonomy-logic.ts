// US-002: Pure logic for the account-taxonomy edge function.
//
// The edge function (supabase/functions/account-taxonomy/index.ts) is a thin
// shell: it verifies the session JWT + account ownership, then calls the single
// read RPC or performs a Postgres write. All request validation / normalization /
// seed-source selection lives here so it is unit-testable without a network or DB
// (mirrors resolve-tags.ts / derive-creative-tags.ts). No I/O in this module.

// Origin stamped on a manually-created Theme/Persona (angle_clusters.source).
// Review-mining rows carry 'csv' / 'csv:<batch_key>' (see ingest-reviews); manual
// entries created through this API are distinguished by ORIGIN_MANUAL.
export const ORIGIN_MANUAL = "manual";

// The write/read actions this function accepts.
export const TAXONOMY_ACTIONS = [
  "list",
  "create",
  "rename",
  "archive",
  "unarchive",
  "set_creative_type",
  "seed",
] as const;
export type TaxonomyAction = (typeof TAXONOMY_ACTIONS)[number];

// Max length for a Theme/Persona label — generous but bounded so a malformed
// payload can't write an unbounded blob into the governed list.
export const MAX_NAME_LENGTH = 200;

/**
 * Normalize a Theme/Persona name: trim, collapse internal whitespace runs to a
 * single space, and cap length. Returns null when the input is missing/empty
 * after trimming (caller treats null as a validation error).
 */
export function normalizeTaxonomyName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, MAX_NAME_LENGTH);
}

/**
 * True when an angle_clusters.source value denotes review-mining provenance.
 * ingest-reviews stamps 'csv' (default) or 'csv:<batch_key>' (batched). Manual
 * entries ('manual') and anything else are NOT review-mining.
 */
export function isReviewMiningSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  return source === "csv" || source.startsWith("csv:");
}

export interface SeedSourceRow {
  id: string;
  source?: string | null;
  archived_at?: string | null;
}

export interface SeedSelection {
  // ids already present from review-mining that constitute the seeded list.
  seededIds: string[];
  // How many review-mining rows were found (== seededIds.length).
  reviewMiningCount: number;
  // True when there was NO real source to seed from (list stays empty — never
  // fabricated). The edge fn returns an empty, non-error result in this case.
  empty: boolean;
}

/**
 * Decide the seed outcome from the account's EXISTING angle_clusters rows.
 *
 * The Theme/Persona list IS angle_clusters (US-001), and review-mining already
 * lands its clusters there via ingest-reviews. So "seeding" is: recognize the
 * real review-mining rows that are already present as the initial governed list.
 * There is no BID-territories source in the DB, so review-mining is the only
 * seed source; when none exist the list stays empty (never fabricated, no LLM).
 *
 * This is pure selection over rows the caller fetched — it performs no writes.
 */
export function selectSeedFromRows(rows: SeedSourceRow[] | null | undefined): SeedSelection {
  const list = Array.isArray(rows) ? rows : [];
  const seededIds = list
    .filter((r) => isReviewMiningSource(r?.source))
    .map((r) => r.id);
  return {
    seededIds,
    reviewMiningCount: seededIds.length,
    empty: seededIds.length === 0,
  };
}

export interface ParsedTaxonomyRequest {
  ok: boolean;
  error?: string;
  action?: TaxonomyAction;
  accountId?: string;
  // create / rename
  name?: string;
  // rename / archive / unarchive — the angle_clusters row id
  angleId?: string;
  // set_creative_type
  creativeTypeId?: string;
  active?: boolean;
}

function isTaxonomyAction(v: unknown): v is TaxonomyAction {
  return typeof v === "string" && (TAXONOMY_ACTIONS as readonly string[]).includes(v);
}

/**
 * Validate + normalize the JSON body of a taxonomy request. Pure: no I/O.
 * The edge fn supplies account_id (already ownership-checked) separately, so it
 * is required here for every action.
 */
export function parseTaxonomyRequest(body: unknown, accountId: unknown): ParsedTaxonomyRequest {
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    return { ok: false, error: "account_id is required" };
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const action = b.action;
  if (!isTaxonomyAction(action)) {
    return {
      ok: false,
      error: `Invalid action — expected one of ${TAXONOMY_ACTIONS.join(", ")}`,
    };
  }

  const base = { ok: true as const, action, accountId };

  switch (action) {
    case "list":
    case "seed":
      return base;

    case "create": {
      const name = normalizeTaxonomyName(b.name);
      if (name === null) return { ok: false, error: "name is required (non-empty)" };
      return { ...base, name };
    }

    case "rename": {
      if (typeof b.angle_id !== "string" || b.angle_id.length === 0) {
        return { ok: false, error: "angle_id is required" };
      }
      const name = normalizeTaxonomyName(b.name);
      if (name === null) return { ok: false, error: "name is required (non-empty)" };
      return { ...base, angleId: b.angle_id, name };
    }

    case "archive":
    case "unarchive": {
      if (typeof b.angle_id !== "string" || b.angle_id.length === 0) {
        return { ok: false, error: "angle_id is required" };
      }
      return { ...base, angleId: b.angle_id };
    }

    case "set_creative_type": {
      if (typeof b.creative_type_id !== "string" || b.creative_type_id.length === 0) {
        return { ok: false, error: "creative_type_id is required" };
      }
      if (typeof b.active !== "boolean") {
        return { ok: false, error: "active (boolean) is required" };
      }
      return { ...base, creativeTypeId: b.creative_type_id, active: b.active };
    }
  }
}
