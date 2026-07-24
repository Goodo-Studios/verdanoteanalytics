// US-005: One-time backfill re-tag of historical creatives.
//
// Re-runs the canonical parser (US-002) + the single precedence resolver
// (_shared/resolve-tags.ts: manual > csv_match > parsed > untagged) over EXISTING
// creatives, with NO Graph API — it re-tags purely from each row's stored
// ad_name and the account's name_mappings. This migrates the four legacy taggers'
// output onto the unified canonical tagging, so historically mis-tagged rows
// (e.g. UGC-style names that landed as untagged/inferred) flip to
// parsed/csv_match with the correct canonical tags.
//
// MANUAL PROTECTION IS STRUCTURAL: the query gate selects only
//   tag_source IN ('untagged','csv','inferred')
// — i.e. untagged + the two legacy auto sources. Rows already at the new
// canonical values ('parsed','csv_match') are skipped, and 'manual' rows are
// NEVER selected, so a human override can never be overwritten.
//
// NO-DEMOTE INVARIANT (US-001): a row whose CURRENT tag_source is a legacy
// auto-tag ('inferred' or 'csv') is NEVER rewritten down to 'untagged'. If the
// fresh resolution for such a row yields tag_source==='untagged', the row is
// SKIPPED and counted as a 'protected' no-op — it keeps its existing legacy tag.
// This makes the 1218->0 regression (foundation-autotag-api US-009: a blind
// global-default re-tag demoted ~1218 'inferred' rows to 'untagged') structurally
// impossible across all 15 global-default accounts. Only STRICT UPGRADES still
// write for these rows: ('inferred'|'csv'|'untagged') -> ('parsed'|'csv_match').
// Pure 'untagged' -> 'untagged' is unchanged (existing behavior); 'manual' stays
// query-gated out. Together these guarantee tag coverage can only hold or rise.
//
// IDEMPOTENT + PROGRESSIVELY DRAINABLE: a row is written only when its resolved
// tags actually differ from what's stored. Rows that flip to parsed/csv_match
// leave the gate permanently; genuinely-untaggable rows stay 'untagged' and the
// actionable set shrinks each run. A per-invocation time budget bounds work and
// returns { drained } so a caller can re-invoke until drained === true.
//
// Stored tag columns hold DISPLAY names, so the parser's canonical vocab is
// mapped through toDisplayName before it enters the resolver (same contract as
// creatives/index.ts, sync/index.ts, sync-coda-names/index.ts).
//
// ─── US-005: Creative-Matrix dimension backfill (second pass) ────────────────
// After the six-dimension re-tag above, a SECOND per-account pass populates the
// Creative-Matrix dimensions (US-001) so the board is populated on day one:
//   • creative_lane + creative_type — DETERMINISTIC placement (runs FIRST), mapped
//     from the resolved ad_type + style columns and the AI ad_format free-text via
//     _shared/derive-creative-tags.ts:deriveMatrixTags. Written FILL-ONLY-EMPTY
//     under a NO-DEMOTE guard (decideMatrixWrite): a currently-null column is
//     filled; a non-null lane/type (manual, csv, or a prior fill) is never
//     overwritten or cleared. Coverage can only hold or rise.
//   • body — AI REVIEW-ONLY. suggestBody() derives a value from value_structure +
//     copywriting_framework and it is merged into creatives.tag_suggestions.body
//     ({value,confidence,signal}); it is NEVER promoted to the creatives.body
//     column. A human promotes it later.
// A coverage sweep reports tagged-vs-untagged per new dimension (explicit untagged
// bucket) per account. The pass shares the same paging + signature-batched apply +
// wall-budget + { drained } contract as the six-dimension pass.
//
// SELF-CHAINING: when the per-invocation wall budget is hit before all work is
// drained, the function fires selfContinue() to re-invoke itself and pick up where
// it left off. Per verdanoteanalytics-self-chaining-fire-selfcontinue-unconditionally
// the continue is fired UNCONDITIONALLY — it is gated ONLY on the single global
// `drained` terminator (the "queue empty" analog), never on any narrower per-account
// / per-pass / per-update sub-condition that could orphan remaining work.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveConvention, type NamingConvention } from "../_shared/naming-convention.ts";
import { parseAdName, type ParsedAdName, type AdNameTags } from "../_shared/parse-ad-name.ts";
import { resolveTags, type PartialTags } from "../_shared/resolve-tags.ts";
import {
  deriveMatrixTags,
  suggestBody,
  decideMatrixWrite,
} from "../_shared/derive-creative-tags.ts";

// Canonical vocab -> display name. Duplicated per the HQ learned rule
// (prefer duplication over a shared extraction needing 5+ wired files).
const DISPLAY_NAMES: Record<string, string> = {
  UGCNative: "UGC Native", StudioClean: "Studio Clean", TextForward: "Text Forward",
  NoTalent: "No Talent", ProblemCallout: "Problem Callout", StatementBold: "Statement Bold",
  AuthorityIntro: "Authority Intro", BeforeAndAfter: "Before & After", PatternInterrupt: "Pattern Interrupt",
};
function toDisplayName(val: string): string { return DISPLAY_NAMES[val] || val; }

/** unique_code is always the first separator-split token (matches the parser contract). */
function uniqueCodeOf(adName: string): string {
  return adName.split("_")[0] || adName;
}

/** Parser tags (canonical vocab) -> display-name AdNameTags for the resolver's parser layer. */
function parsedDisplayTags(parsed: ParsedAdName | null): AdNameTags | null {
  if (!parsed) return null;
  const t = parsed.tags;
  return {
    ad_type: t.ad_type ? toDisplayName(t.ad_type) : null,
    person: t.person ? toDisplayName(t.person) : null,
    style: t.style ? toDisplayName(t.style) : null,
    product: t.product,
    hook: t.hook ? toDisplayName(t.hook) : null,
    theme: t.theme,
  };
}

/** A name_mappings row -> PartialTags for the resolver's Coda (csv_match) layer. */
function mappingTags(m: Record<string, unknown> | null): PartialTags | null {
  if (!m) return null;
  return {
    ad_type: (m.ad_type as string) ?? null,
    person: (m.person as string) ?? null,
    style: (m.style as string) ?? null,
    product: (m.product as string) ?? null,
    hook: (m.hook as string) ?? null,
    theme: (m.theme as string) ?? null,
  };
}

// The six tag dimensions, stable order.
const DIMS = ["ad_type", "person", "style", "product", "hook", "theme"] as const;

// Legacy + untagged sources the backfill is allowed to re-tag. 'manual' and the
// already-canonical 'parsed'/'csv_match' are intentionally excluded.
const RETAG_SOURCES = ["untagged", "csv", "inferred"];

const PAGE = 500;          // rows fetched per page
const UPDATE_CHUNK = 200;  // ad_ids per signature-batched update
const DEADLINE_MS = 50_000; // per-invocation wall budget (edge fn ~60s)

interface Counters { scanned: number; updated: number; unchanged: number; still_untagged: number; protected: number; errors: number; }
function newCounters(): Counters { return { scanned: 0, updated: 0, unchanged: 0, still_untagged: 0, protected: 0, errors: 0 }; }

// US-005 matrix-pass counters (per account).
interface MatrixCounters {
  scanned: number;        // rows examined in the matrix pass
  lane_filled: number;    // rows whose null creative_lane was filled deterministically
  type_filled: number;    // rows whose null creative_type was filled deterministically
  body_suggested: number; // rows whose tag_suggestions.body was written/updated (review-only)
  protected: number;      // rows where an existing lane/type was kept (no-demote guard)
  unchanged: number;      // rows the matrix pass left untouched
  errors: number;
}
function newMatrixCounters(): MatrixCounters {
  return { scanned: 0, lane_filled: 0, type_filled: 0, body_suggested: 0, protected: 0, unchanged: 0, errors: 0 };
}

// US-005 coverage sweep (per account): tagged-vs-untagged per new dimension, with
// an explicit untagged bucket. Computed AFTER the matrix pass applies.
interface MatrixCoverage {
  total: number;
  lane_tagged: number;
  lane_untagged: number;
  type_tagged: number;
  type_untagged: number;
}

/** The request/self-chain body shape. */
interface BackfillBody {
  account_id?: string;
  dry_run?: boolean;
  /** Informational: set by selfContinue() so logs distinguish chained invocations. */
  _chained?: boolean;
}

/**
 * Fire-and-forget re-invocation of THIS function to continue draining after the
 * wall budget is hit. Non-blocking (kept alive via EdgeRuntime.waitUntil, matching
 * sync/index.ts). Carries the SAME scope (account_id, dry_run) forward so the
 * continuation resumes the exact same work. Called UNCONDITIONALLY by the handler
 * whenever `drained === false` (see the self-chaining policy note in the header) —
 * the caller adds no narrower gate.
 */
async function selfContinue(body: BackfillBody): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.warn("backfill-retag selfContinue: missing env vars — cannot self-chain");
      return;
    }
    const continuePromise = fetch(`${supabaseUrl}/functions/v1/backfill-retag`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ ...body, _chained: true }),
    }).catch((err) => {
      console.warn("backfill-retag selfContinue fetch error (non-fatal):", err);
    });
    // Keep the isolate alive until the request leaves (see sync/index.ts rationale).
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(continuePromise);
    console.log("backfill-retag selfContinue: fired non-blocking continue invocation");
  } catch (err) {
    console.warn("backfill-retag selfContinue error (non-fatal):", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedMs = Date.now();
  const timedOut = () => Date.now() - startedMs > DEADLINE_MS;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional scoping: { account_id?, dry_run? }. No body is fine (defaults).
    let body: BackfillBody = {};
    try { body = await req.json(); } catch { /* no body */ }
    const dryRun = body.dry_run === true;

    // Resolve the set of accounts to process.
    let accountIds: string[];
    if (body.account_id) {
      accountIds = [body.account_id];
    } else {
      const { data: accounts, error } = await supabase
        .from("ad_accounts")
        .select("id")
        .eq("is_active", true);
      if (error) throw error;
      accountIds = (accounts || []).map((a) => a.id);
    }

    const perAccount = new Map<string, Counters>();
    const perAccountMatrix = new Map<string, MatrixCounters>();
    const perAccountCoverage = new Map<string, MatrixCoverage>();
    let drained = true; // false if we hit the time budget before finishing

    for (const accountId of accountIds) {
      if (timedOut()) { drained = false; break; }

      const counters = newCounters();
      perAccount.set(accountId, counters);

      // Per-account: convention once + name_mappings preloaded into a Map.
      const convention: NamingConvention | null = await resolveConvention(supabase, accountId);
      const { data: mappings } = await supabase
        .from("name_mappings")
        .select("*")
        .eq("account_id", accountId);
      const mappingByCode = new Map<string, Record<string, unknown>>();
      for (const m of (mappings || [])) {
        if (m.unique_code) mappingByCode.set(m.unique_code, m);
      }

      // Page through this account's re-taggable creatives.
      let offset = 0;
      let accountDrained = true;
      // deno-lint-ignore no-explicit-any
      const updates: { ad_id: string; update: Record<string, any> }[] = [];

      // deno-lint-ignore no-constant-condition
      while (true) {
        if (timedOut()) { drained = false; accountDrained = false; break; }

        const { data: rows, error: fetchErr } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, tag_source, unique_code, ad_type, person, style, product, hook, theme")
          .eq("account_id", accountId)
          .in("tag_source", RETAG_SOURCES)
          .order("ad_id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (fetchErr) throw fetchErr;

        const batch = rows || [];
        for (const c of batch) {
          counters.scanned++;
          const parsed = convention ? parseAdName(c.ad_name, convention) : null;
          const unique_code = parsed?.unique_code || uniqueCodeOf(c.ad_name);
          const { tags, tag_source } = resolveTags(
            parsedDisplayTags(parsed),
            mappingTags(mappingByCode.get(unique_code) ?? null),
            null, // manual rows are excluded by the query gate — never touched here
          );

          // Compare resolved against stored. Skip-gate: only write on a real change.
          const changed =
            tag_source !== c.tag_source ||
            unique_code !== (c.unique_code ?? null) ||
            DIMS.some((d) => (tags[d] ?? null) !== (c[d as keyof typeof c] ?? null));

          if (tag_source === "untagged") {
            // NO-DEMOTE INVARIANT (US-001): never rewrite a legacy auto-tagged
            // row ('inferred'|'csv') down to 'untagged'. Such a row keeps its
            // existing tag and is counted as a protected no-op — this is what
            // makes the 1218->0 demotion regression structurally impossible.
            if (c.tag_source === "inferred" || c.tag_source === "csv") {
              counters.protected++;
              continue;
            }
            counters.still_untagged++;
            // A pure 'untagged' row that resolves to 'untagged' is left alone;
            // there is never anything to write here (no upgrade available).
            if (!changed) continue;
          }

          if (!changed) { counters.unchanged++; continue; }

          updates.push({
            ad_id: c.ad_id,
            update: {
              tag_source,
              unique_code,
              ad_type: tags.ad_type,
              person: tags.person,
              style: tags.style,
              product: tags.product,
              hook: tags.hook,
              theme: tags.theme,
            },
          });
        }

        if (batch.length < PAGE) break; // last page
        offset += PAGE;
      }

      if (dryRun) {
        counters.updated = updates.length; // would-update count
      } else {
        // Apply — batch by identical update signature to cut round-trips.
        // deno-lint-ignore no-explicit-any
        const signatureMap = new Map<string, { update: Record<string, any>; ad_ids: string[] }>();
        for (const item of updates) {
          const sig = JSON.stringify(item.update);
          if (!signatureMap.has(sig)) signatureMap.set(sig, { update: item.update, ad_ids: [] });
          signatureMap.get(sig)!.ad_ids.push(item.ad_id);
        }
        for (const { update, ad_ids } of signatureMap.values()) {
          for (let i = 0; i < ad_ids.length; i += UPDATE_CHUNK) {
            const chunk = ad_ids.slice(i, i + UPDATE_CHUNK);
            const { data: upData, error: upErr } = await supabase
              .from("creatives")
              .update(update)
              .in("ad_id", chunk)
              .select("ad_id");
            if (upErr) { counters.errors += chunk.length; }
            else { counters.updated += (upData?.length ?? chunk.length); }
          }
        }

        // Refresh the account's untagged_count to reflect the re-tag.
        if (accountDrained) {
          const { count } = await supabase
            .from("creatives")
            .select("*", { count: "exact", head: true })
            .eq("account_id", accountId)
            .eq("tag_source", "untagged");
          await supabase.from("ad_accounts").update({ untagged_count: count || 0 }).eq("id", accountId);
        }
      }

      // ─── US-005 matrix pass: deterministic lane/type + review-only body ──────
      // Runs after the six-dimension pass so it reads the freshly-resolved ad_type
      // and style. Scans ALL sources (unlike the six-dim gate) because every ad —
      // manual, csv, parsed, or untagged — needs a matrix placement for the board.
      // The no-demote guard (decideMatrixWrite) is what keeps this safe over
      // manual/csv rows: their non-null lane/type is never overwritten or cleared.
      const matrix = newMatrixCounters();
      perAccountMatrix.set(accountId, matrix);

      let matrixOffset = 0;
      // deno-lint-ignore no-explicit-any
      const matrixUpdates: { ad_id: string; update: Record<string, any> }[] = [];

      // deno-lint-ignore no-constant-condition
      while (true) {
        if (timedOut()) { drained = false; accountDrained = false; break; }

        const { data: mrows, error: mErr } = await supabase
          .from("creatives")
          .select("ad_id, ad_type, style, ad_format, creative_lane, creative_type, value_structure, copywriting_framework, tag_suggestions")
          .eq("account_id", accountId)
          .order("ad_id", { ascending: true })
          .range(matrixOffset, matrixOffset + PAGE - 1);
        if (mErr) throw mErr;

        const mbatch = mrows || [];
        for (const c of mbatch) {
          matrix.scanned++;

          // (1) Deterministic lane/type under the FILL-ONLY-EMPTY no-demote guard.
          const derived = deriveMatrixTags({ ad_type: c.ad_type, style: c.style, ad_format: c.ad_format });
          const decision = decideMatrixWrite(
            { creative_lane: c.creative_lane ?? null, creative_type: c.creative_type ?? null },
            derived,
          );
          // deno-lint-ignore no-explicit-any
          const rowUpdate: Record<string, any> = {};
          if (decision.changed) {
            if ((c.creative_lane ?? null) === null && decision.creative_lane !== null) {
              rowUpdate.creative_lane = decision.creative_lane;
              matrix.lane_filled++;
            }
            if ((c.creative_type ?? null) === null && decision.creative_type !== null) {
              rowUpdate.creative_type = decision.creative_type;
              matrix.type_filled++;
            }
          } else if (decision.protectedFromDemote) {
            // Existing lane/type kept where the deterministic layer had nothing —
            // the no-demote guard fired (never cleared a manual/csv/prior tag).
            matrix.protected++;
          }

          // (2) REVIEW-ONLY body suggestion → tag_suggestions.body (never the column).
          const suggestion = suggestBody({
            value_structure: c.value_structure,
            copywriting_framework: c.copywriting_framework,
          });
          if (suggestion) {
            const existing = (c.tag_suggestions && typeof c.tag_suggestions === "object")
              ? c.tag_suggestions as Record<string, unknown>
              : {};
            const prior = existing.body as { value?: string } | undefined;
            // Idempotent skip-gate: only write when the suggested value actually changes.
            if (!prior || prior.value !== suggestion.value) {
              rowUpdate.tag_suggestions = { ...existing, body: suggestion };
              matrix.body_suggested++;
            }
          }

          if (Object.keys(rowUpdate).length > 0) {
            matrixUpdates.push({ ad_id: c.ad_id, update: rowUpdate });
          } else {
            matrix.unchanged++;
          }
        }

        if (mbatch.length < PAGE) break; // last page
        matrixOffset += PAGE;
      }

      // Apply matrix updates (skip writes in dry_run). Signature-batched like the
      // six-dim pass — pure lane/type updates share signatures; body-merge updates
      // (per-row tag_suggestions) mostly stand alone. Either way, correct + bounded.
      if (!dryRun) {
        // deno-lint-ignore no-explicit-any
        const mSig = new Map<string, { update: Record<string, any>; ad_ids: string[] }>();
        for (const item of matrixUpdates) {
          const sig = JSON.stringify(item.update);
          if (!mSig.has(sig)) mSig.set(sig, { update: item.update, ad_ids: [] });
          mSig.get(sig)!.ad_ids.push(item.ad_id);
        }
        for (const { update, ad_ids } of mSig.values()) {
          for (let i = 0; i < ad_ids.length; i += UPDATE_CHUNK) {
            const chunk = ad_ids.slice(i, i + UPDATE_CHUNK);
            const { error: upErr } = await supabase
              .from("creatives")
              .update(update)
              .in("ad_id", chunk);
            if (upErr) { matrix.errors += chunk.length; }
          }
        }
      }

      // Coverage sweep: tagged-vs-untagged per new dimension, explicit untagged
      // bucket. Only meaningful once the account's matrix pass fully drained.
      if (accountDrained) {
        const totalRes = await supabase
          .from("creatives").select("*", { count: "exact", head: true })
          .eq("account_id", accountId);
        const laneRes = await supabase
          .from("creatives").select("*", { count: "exact", head: true })
          .eq("account_id", accountId).is("creative_lane", null);
        const typeRes = await supabase
          .from("creatives").select("*", { count: "exact", head: true })
          .eq("account_id", accountId).is("creative_type", null);
        const total = totalRes.count ?? 0;
        const laneUntagged = laneRes.count ?? 0;
        const typeUntagged = typeRes.count ?? 0;
        perAccountCoverage.set(accountId, {
          total,
          lane_tagged: total - laneUntagged,
          lane_untagged: laneUntagged,
          type_tagged: total - typeUntagged,
          type_untagged: typeUntagged,
        });
      }
    }

    const totals = [...perAccount.values()].reduce(
      (acc, c) => ({
        scanned: acc.scanned + c.scanned,
        updated: acc.updated + c.updated,
        unchanged: acc.unchanged + c.unchanged,
        still_untagged: acc.still_untagged + c.still_untagged,
        protected: acc.protected + c.protected,
        errors: acc.errors + c.errors,
      }),
      newCounters(),
    );

    const matrixTotals = [...perAccountMatrix.values()].reduce(
      (acc, m) => ({
        scanned: acc.scanned + m.scanned,
        lane_filled: acc.lane_filled + m.lane_filled,
        type_filled: acc.type_filled + m.type_filled,
        body_suggested: acc.body_suggested + m.body_suggested,
        protected: acc.protected + m.protected,
        unchanged: acc.unchanged + m.unchanged,
        errors: acc.errors + m.errors,
      }),
      newMatrixCounters(),
    );

    // SELF-CHAINING (verdanoteanalytics-self-chaining-fire-selfcontinue-unconditionally):
    // fire the continuation UNCONDITIONALLY whenever work remains — the sole gate is
    // the global `drained` terminator (the queue-empty analog). No narrower per-account
    // / per-pass / per-update condition guards this call, so no remaining work is ever
    // orphaned. When drained === true there is nothing left, so the chain stops.
    if (!drained) {
      await selfContinue({ account_id: body.account_id, dry_run: dryRun });
    }

    const summary = {
      success: true,
      dry_run: dryRun,
      drained,
      self_continued: !drained,
      accounts_processed: perAccount.size,
      totals,
      matrix_totals: matrixTotals,
      per_account: Object.fromEntries([...perAccount.entries()].map(([id, c]) => [id, c])),
      per_account_matrix: Object.fromEntries([...perAccountMatrix.entries()].map(([id, m]) => [id, m])),
      matrix_coverage: Object.fromEntries([...perAccountCoverage.entries()].map(([id, cov]) => [id, cov])),
    };
    console.log("backfill-retag:", JSON.stringify({
      ...summary,
      per_account: undefined,
      per_account_matrix: undefined,
      matrix_coverage: undefined,
    }));
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("backfill-retag error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
