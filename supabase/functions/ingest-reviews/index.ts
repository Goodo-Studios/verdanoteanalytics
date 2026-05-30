// US-002 (Phase C, Feature #5): service-role ingest edge function for raw
// customer reviews + extracted voice-of-customer angle clusters.
//
// ROLE: a THIN service-role persister. All LLM work (VOC extraction, angle
// clustering) happens in HQ — this function does payload validation + a scoped,
// idempotent write into the customer_reviews / angle_clusters tables created by
// migration 20260530110000. NO model calls, no business logic here.
//
// DATA FLOW: HQ review-mining flow (US-003) -> POST here with
//   { account_id, batch_key, reviews[], angle_clusters[] }
// -> rows land in public.customer_reviews + public.angle_clusters scoped to the
// supplied account_id. The matching read surface is the /api endpoint (US-004).
//
// AUTH (consistent with other internal write paths, not the read-only /api):
//   * The Supabase gateway already requires an Authorization bearer (service
//     role / anon) to reach the function; verify_jwt is false (no end-user JWT).
//   * On top of that we require a shared-secret header (x-ingest-secret, or a
//     Bearer matching INGEST_SECRET) so the dumb writer is not callable by any
//     holder of the anon key. The function itself uses the service-role client.
//
// IDEMPOTENCY: the caller supplies a stable `batch_key` (a.k.a. generation key).
// Re-POSTing the same { account_id, batch_key } MUST NOT duplicate rows. We
// achieve this without a schema change by, before inserting, deleting any prior
// rows for the same (account_id, batch_key), so a re-run replaces the previous
// batch's rows 1:1 rather than appending. The two tables carry the batch marker
// differently:
//   * customer_reviews: batch_key is stamped into raw->>batch_key.
//   * angle_clusters: it has no batch_key column, so the batch is encoded into
//     the `source` field as `csv:<batch_key>` (see batchSource()).
// Both the insert and the delete sweep use these same markers, so the table
// reaches an identical state on every re-POST of a given batch.
//
// Mirrors the backfill-retag / sync-coda-names service-role registration pattern
// (registered in scripts/deploy-functions.sh + supabase/config.toml, verify_jwt
// = false). Exposes a testable handler(req, supabaseOverride); Deno.serve is
// guarded by INGEST_NO_SERVE so the test can import the module without binding.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

// ---- Payload types ---------------------------------------------------------

export interface ReviewInput {
  source?: string | null;
  source_url?: string | null;
  source_identifier?: string | null;
  review_text?: string | null;
  rating?: number | null;
  author?: string | null;
  reviewed_at?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface AngleClusterInput {
  label?: string | null;
  summary?: string | null;
  theme?: string | null;
  pains?: string[] | null;
  desires?: string[] | null;
  objections?: string[] | null;
  customer_language?: string[] | null;
  supporting_review_ids?: string[] | null;
  score?: number | null;
  source?: string | null;
}

export interface IngestPayload {
  account_id?: unknown;
  batch_key?: unknown;
  reviews?: unknown;
  angle_clusters?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  account_id?: string;
  batch_key?: string;
  reviews?: ReviewInput[];
  angle_clusters?: AngleClusterInput[];
}

// ---- Validation (pure, exported for tests) ---------------------------------

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string") as string[];
}

// ---- supporting_review_ids reconciliation ----------------------------------
//
// angle_clusters.supporting_review_ids is a UUID[] column, but the HQ flow
// cannot know customer_reviews.id at extraction time (DB assigns UUIDs only on
// insert here). So the producer (review-mining buildIngestPayload) emits stable
// tokens of the form `review_index:<n>`, where <n> is the position of the review
// in this POST's `reviews` array. The handler inserts reviews FIRST, learns each
// row's UUID, then resolves those tokens to real UUIDs before inserting clusters.
// Anything that resolves to neither a real UUID nor a known index is dropped, so
// the UUID[] column never receives invalid input (which previously 500'd with
// Postgres 22P02 "invalid input syntax for type uuid").

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return typeof s === "string" && UUID_RE.test(s);
}

/** Parse a `review_index:<n>` token to its integer index, else null. */
export function reviewIndexToken(s: string): number | null {
  const m = /^review_index:(\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}

/**
 * Build a resolver that maps a cluster's raw supporting_review_ids
 * (`review_index:<n>` tokens and/or pass-through UUIDs) to real
 * customer_reviews UUIDs, using the index->id map learned from the reviews
 * insert. Unresolvable entries are dropped so the UUID[] column stays valid.
 */
export function makeSupportingResolver(
  indexToId: Map<number, string>,
): (ids: string[]) => string[] {
  return (ids: string[]): string[] => {
    const out: string[] = [];
    for (const raw of ids) {
      if (isUuid(raw)) {
        out.push(raw);
        continue;
      }
      const idx = reviewIndexToken(raw);
      if (idx != null) {
        const id = indexToId.get(idx);
        if (id) out.push(id);
      }
      // else: unknown token -> drop (keeps the UUID[] column valid)
    }
    return out;
  };
}

/** Default resolver when no index map is available: keep only valid UUIDs. */
export function keepUuids(ids: string[]): string[] {
  return ids.filter(isUuid);
}

/**
 * Validate the POST body. account_id + batch_key are required; reviews and
 * angle_clusters must be arrays (either may be empty). Returns a normalized,
 * defensively-typed shape so the writer never touches unvalidated input.
 */
export function validatePayload(body: IngestPayload | null | undefined): ValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const account_id = body.account_id;
  if (typeof account_id !== "string" || account_id.trim() === "") {
    return { ok: false, error: "account_id is required (non-empty string)" };
  }
  const batch_key = body.batch_key;
  if (typeof batch_key !== "string" || batch_key.trim() === "") {
    return { ok: false, error: "batch_key is required for idempotency (non-empty string)" };
  }
  if (body.reviews !== undefined && !Array.isArray(body.reviews)) {
    return { ok: false, error: "reviews must be an array" };
  }
  if (body.angle_clusters !== undefined && !Array.isArray(body.angle_clusters)) {
    return { ok: false, error: "angle_clusters must be an array" };
  }
  const reviews = Array.isArray(body.reviews) ? (body.reviews as ReviewInput[]) : [];
  const angle_clusters = Array.isArray(body.angle_clusters)
    ? (body.angle_clusters as AngleClusterInput[])
    : [];
  if (reviews.length === 0 && angle_clusters.length === 0) {
    return { ok: false, error: "Nothing to ingest: reviews and angle_clusters are both empty" };
  }
  return { ok: true, account_id, batch_key, reviews, angle_clusters };
}

// ---- Batch marker ----------------------------------------------------------

/**
 * The angle_clusters table has no batch_key column. To keep cluster writes
 * idempotent per batch WITHOUT a schema change, we encode the batch into the
 * `source` provenance field as `csv:<batch_key>`. Both the insert (toClusterRow)
 * and the delete sweep target this exact value, so a re-POST replaces the prior
 * batch's clusters. Readers treat the prefix before ':' as the provenance.
 */
export function batchSource(batch_key: string): string {
  return `csv:${batch_key}`;
}

// ---- Row mapping (pure, exported for tests) --------------------------------

/**
 * Map a validated review to a customer_reviews insert row, stamping batch_key
 * into raw. When `index` is supplied (the review's position in the POST's
 * reviews array), it is also stamped into raw.review_index so the handler can
 * deterministically map cluster `review_index:<n>` tokens back to the row's
 * DB-assigned UUID after insert, independent of insert/return ordering.
 */
export function toReviewRow(account_id: string, batch_key: string, r: ReviewInput, index?: number) {
  const raw = (r.raw && typeof r.raw === "object") ? { ...r.raw } : {};
  const stamped: Record<string, unknown> = { ...raw, batch_key };
  if (typeof index === "number") stamped.review_index = index;
  return {
    account_id,
    source: r.source ?? "csv",
    source_url: r.source_url ?? null,
    source_identifier: r.source_identifier ?? null,
    review_text: r.review_text ?? null,
    rating: typeof r.rating === "number" ? r.rating : null,
    author: r.author ?? null,
    reviewed_at: r.reviewed_at ?? null,
    raw: stamped,
  };
}

/**
 * Map a validated angle cluster to an angle_clusters insert row.
 * `resolveSupporting` converts the producer's supporting_review_ids tokens
 * (`review_index:<n>` and/or UUIDs) to real customer_reviews UUIDs; it defaults
 * to keepUuids (drop non-UUID tokens) so the UUID[] column is never fed invalid
 * input even when no index map is available.
 */
export function toClusterRow(
  account_id: string,
  batch_key: string,
  c: AngleClusterInput,
  resolveSupporting: (ids: string[]) => string[] = keepUuids,
) {
  return {
    account_id,
    label: c.label ?? null,
    summary: c.summary ?? null,
    theme: c.theme ?? null,
    pains: asStringArray(c.pains),
    desires: asStringArray(c.desires),
    objections: asStringArray(c.objections),
    customer_language: asStringArray(c.customer_language),
    supporting_review_ids: resolveSupporting(asStringArray(c.supporting_review_ids)),
    score: typeof c.score === "number" ? c.score : null,
    // Encode the batch into `source` (csv:<batch_key>) so the delete sweep can
    // target exactly this batch's clusters. This must match the handler's sweep.
    source: batchSource(batch_key),
  };
}

// ---- Service-role auth guard ----------------------------------------------

/**
 * Returns true if the request carries the shared ingest secret. Accepts either
 * an `x-ingest-secret` header or an `Authorization: Bearer <secret>`. If
 * INGEST_SECRET is unset (e.g. local dev with no env), the guard is open — the
 * Supabase gateway bearer is still required to reach the function at all.
 */
export function isAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return true; // no secret configured -> rely on gateway bearer only
  const headerSecret = req.headers.get("x-ingest-secret");
  if (headerSecret && headerSecret === secret) return true;
  const auth = req.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  return false;
}

// ---- Handler (testable) ----------------------------------------------------

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/**
 * Core request handler. `supabaseOverride` is injected by tests with a recording
 * mock client; in production it is undefined and a service-role client is built.
 * A non-client truthy arg (e.g. Deno.serve's connInfo) is ignored.
 */
export async function handler(req: Request, supabaseOverride?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  // Shared-secret guard (on top of the gateway bearer).
  if (!isAuthorized(req, Deno.env.get("INGEST_SECRET") ?? undefined)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: IngestPayload | null = null;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const v = validatePayload(body);
  if (!v.ok) return json({ success: false, error: v.error }, 400);

  // v.ok guarantees these are present; narrow to non-optional locals.
  const account_id = v.account_id!;
  const batch_key = v.batch_key!;
  const reviews = v.reviews ?? [];
  const angle_clusters = v.angle_clusters ?? [];

  // Build the service-role client unless a test injected one.
  const isClient = (o: unknown): o is SupabaseLike =>
    !!o && typeof (o as { from?: unknown }).from === "function";
  const supabase: SupabaseLike = isClient(supabaseOverride)
    ? supabaseOverride
    : createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

  try {
    // IDEMPOTENCY SWEEP: remove any prior rows for this (account_id, batch_key)
    // so a re-POST of the same batch replaces rather than duplicates. Each table
    // carries the batch marker per the IDEMPOTENCY note at the top of this file:
    // customer_reviews via raw->>batch_key, angle_clusters via source=csv:<key>.

    // Sweep reviews for this batch.
    {
      const { error } = await supabase
        .from("customer_reviews")
        .delete()
        .eq("account_id", account_id)
        .eq("raw->>batch_key", batch_key);
      if (error) throw error;
    }

    // Sweep clusters for this batch (source = csv:<batch_key>, set in toClusterRow).
    {
      const { error } = await supabase
        .from("angle_clusters")
        .delete()
        .eq("account_id", account_id)
        .eq("source", batchSource(batch_key));
      if (error) throw error;
    }

    // Insert reviews, stamping each row's array index into raw.review_index so
    // we can map cluster `review_index:<n>` tokens to the DB-assigned UUIDs.
    let reviews_inserted = 0;
    const indexToId = new Map<number, string>();
    if (reviews.length > 0) {
      const rows = reviews.map((r, i) => toReviewRow(account_id, batch_key, r, i));
      const { data, error } = await supabase
        .from("customer_reviews")
        .insert(rows)
        .select("id, raw");
      if (error) throw error;
      reviews_inserted = (data?.length ?? rows.length);
      // Build index->UUID map from the returned rows (order-independent: we read
      // raw.review_index rather than relying on RETURNING order).
      for (const row of (data ?? []) as Array<{ id?: unknown; raw?: unknown }>) {
        const raw = (row?.raw && typeof row.raw === "object") ? row.raw as Record<string, unknown> : {};
        const idx = raw.review_index;
        if (typeof idx === "number" && typeof row.id === "string") {
          indexToId.set(idx, row.id);
        }
      }
    }

    // Insert clusters, resolving supporting_review_ids tokens to real review
    // UUIDs via the index map (pass-through valid UUIDs, drop unresolved tokens).
    let clusters_inserted = 0;
    if (angle_clusters.length > 0) {
      const resolveSupporting = makeSupportingResolver(indexToId);
      const rows = angle_clusters.map((c) => toClusterRow(account_id, batch_key, c, resolveSupporting));
      const { data, error } = await supabase
        .from("angle_clusters")
        .insert(rows)
        .select("id");
      if (error) throw error;
      clusters_inserted = (data?.length ?? rows.length);
    }

    const summary = {
      success: true,
      account_id,
      batch_key,
      reviews_inserted,
      clusters_inserted,
    };
    console.log("ingest-reviews:", JSON.stringify(summary));
    return json(summary, 200);
  } catch (err: unknown) {
    console.error("ingest-reviews error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: msg }, 500);
  }
}

if (Deno.env.get("INGEST_NO_SERVE") !== "1") {
  Deno.serve((req) => handler(req));
}
