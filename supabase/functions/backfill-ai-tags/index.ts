// US-009: One-time (re-runnable) backfill of the deterministic AI tag layer.
//
// Applies the AI-derived auto-tag layer (supabase/functions/_shared/
// derive-creative-tags.ts) across the already-analyzed creative corpus, under the
// locked precedence (manual > csv_match > parsed > ai > untagged). For each row it
// re-resolves the ad-name parser output (the 'parsed' layer — the PRIMARY source
// for style/person) PLUS the deterministic AI layer (hook/ad_type/product/theme
// mapped from the analyze-creative framework fields + media kind), and writes the
// six tag columns + tag_source + needs_tag_review.
//
// NO LLM CALLS. Everything is a deterministic re-map of fields analyze-creative
// already extracted — same design as backfill-retag (US-005), extended with the
// AI layer. This fn does NOT touch analyze-creative or its prompts; the ongoing
// hook (run the same derivation inside analyze-creative after each analysis) is a
// small follow-up once that file is free — see the note at the bottom.
//
// SAFETY / PRECEDENCE (never clobber a human/Coda/ad-name tag):
//   - The query gate selects tag_source IN ('untagged','parsed','csv_match','csv',
//     'inferred') — i.e. everything EXCEPT 'manual'. Manual rows are never fetched,
//     so a human override can never be overwritten. AI values below-parser only
//     FILL dimensions no higher layer supplied, so parsed/csv rows just gain the
//     empty dimensions AI can fill (and keep their parsed/csv tag_source).
//   - NO-DEMOTE INVARIANT (US-001 carry-over): a legacy auto row ('inferred'|'csv')
//     that re-resolves to 'untagged' is SKIPPED (protected), never rewritten down.
//     AI only adds coverage, so tag_source can only hold or rise.
//
// ANALYSIS GATE: only rows whose analysis_status IN ('done','analyzed') carry AI
// fields, so only those are scanned. Un-analyzed rows are left for after analysis
// completes (the owner runs this backfill later, per the plan).
//
// IDEMPOTENT + PROGRESSIVELY DRAINABLE + POOLER-SAFE: a row is written only when
// the resolved tags/source/review-flag actually differ from what's stored, so
// re-runs converge and cost nothing once drained. Work is paged (bounded memory),
// updates are signature-batched + chunked (bounded statement size — pooler-safe),
// and a per-invocation wall budget returns { drained:false } so a caller re-invokes
// until drained === true.
//
// MEASUREMENT (owner ask): every response (including dry_run) returns `coverage`
// — per-dimension counts of how many SCANNED rows would get each tag from the ad
// name ('parsed') vs the AI layer ('ai'). This is the tool to get the exact
// style/person-from-ad-name coverage over the real corpus; run with { dry_run:true }
// (optionally per account_id) and read coverage.parsed.style / .person.
//
// Stored tag columns hold DISPLAY names, so the parser's canonical vocab is mapped
// through toDisplayName before it enters the resolver (same contract as
// creatives/index.ts, sync/index.ts, backfill-retag/index.ts).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveConvention, type NamingConvention } from "../_shared/naming-convention.ts";
import { parseAdName, type ParsedAdName, type AdNameTags } from "../_shared/parse-ad-name.ts";
import { type PartialTags, type TagSource } from "../_shared/resolve-tags.ts";
import { computeAutoTags } from "../_shared/derive-creative-tags.ts";
import { NO_VIDEO_SENTINELS } from "../_shared/media-discovery.ts";
import { errorMessage } from "../_shared/error-message.ts";

// Canonical vocab -> display name. Duplicated per the HQ learned rule (prefer
// duplication over a shared extraction needing 5+ wired files).
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

/** Parser tags (canonical vocab) -> display-name AdNameTags for the parser layer. */
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

/** framework_json may arrive as a jsonb object or a JSON string. Coerce to object|null. */
function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch { return null; }
  }
  return null;
}

const DIMS = ["ad_type", "person", "style", "product", "hook", "theme"] as const;
type Dim = typeof DIMS[number];

// The row shape we select. Cast explicitly (as analyze-creative does for its
// CreativeRow) because the generated Supabase types are stale — they pre-date the
// framework columns (hook_type / value_structure / framework_json) and the new
// needs_tag_review column, so the typed client would otherwise infer an error union.
interface Row {
  ad_id: string;
  ad_name: string;
  tag_source: string | null;
  unique_code: string | null;
  needs_tag_review: boolean | null;
  ad_type: string | null;
  person: string | null;
  style: string | null;
  product: string | null;
  hook: string | null;
  theme: string | null;
  video_url: string | null;
  hook_type: string | null;
  value_structure: string | null;
  framework_json: unknown;
}

// Sources scanned: everything EXCEPT 'manual' (never fetched → never clobbered).
const SCAN_SOURCES = ["untagged", "parsed", "csv_match", "csv", "inferred"];
// Only analyzed rows carry AI fields.
const ANALYSIS_DONE = ["done", "analyzed"];

const PAGE = 500;          // rows fetched per page
const UPDATE_CHUNK = 200;  // ad_ids per signature-batched update (pooler-safe)
const DEADLINE_MS = 50_000; // per-invocation wall budget (edge fn ~60s)

interface Counters { scanned: number; updated: number; unchanged: number; protected: number; flagged: number; errors: number; }
function newCounters(): Counters { return { scanned: 0, updated: 0, unchanged: 0, protected: 0, flagged: 0, errors: 0 }; }

// Per-dimension coverage: how many scanned rows would receive each tag, split by
// the layer that supplied it. The decision-relevant cells are parsed.style /
// parsed.person (ad-name coverage) and ai.* (what the AI layer adds).
type CoverageBucket = Record<Dim, number>;
function newBucket(): CoverageBucket { return { ad_type: 0, person: 0, style: 0, product: 0, hook: 0, theme: 0 }; }

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
    let body: { account_id?: string; dry_run?: boolean } = {};
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

    const totals = newCounters();
    // coverage[layer][dim] — counts across scanned rows.
    const coverage: Record<TagSource, CoverageBucket> = {
      manual: newBucket(), csv_match: newBucket(), parsed: newBucket(),
      ai: newBucket(), untagged: newBucket(),
    };
    let drained = true; // false if we hit the time budget before finishing

    for (const accountId of accountIds) {
      if (timedOut()) { drained = false; break; }

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

      let offset = 0;
      let accountDrained = true;
      // deno-lint-ignore no-explicit-any
      const updates: { ad_id: string; update: Record<string, any> }[] = [];

      // deno-lint-ignore no-constant-condition
      while (true) {
        if (timedOut()) { drained = false; accountDrained = false; break; }

        const { data: rows, error: fetchErr } = await supabase
          .from("creatives")
          .select(
            "ad_id, ad_name, tag_source, unique_code, needs_tag_review, " +
            "ad_type, person, style, product, hook, theme, " +
            "video_url, hook_type, value_structure, framework_json",
          )
          .eq("account_id", accountId)
          .in("analysis_status", ANALYSIS_DONE)
          .in("tag_source", SCAN_SOURCES)
          .order("ad_id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (fetchErr) throw fetchErr;

        const batch = (rows || []) as unknown as Row[];
        for (const c of batch) {
          totals.scanned++;

          const parsed = convention ? parseAdName(c.ad_name, convention) : null;
          const unique_code = parsed?.unique_code || uniqueCodeOf(c.ad_name);
          const isVideo = !!c.video_url && !NO_VIDEO_SENTINELS.has(c.video_url);

          const resolved = computeAutoTags({
            parsed: parsedDisplayTags(parsed),
            ai: {
              hook_type: c.hook_type,
              value_structure: c.value_structure,
              framework_json: asObject(c.framework_json),
              isVideo,
            },
            nameMapping: mappingTags(mappingByCode.get(unique_code) ?? null),
            manual: null, // manual rows are query-gated out — never touched here
          });
          const { tags, tag_source, sources, needs_review } = resolved;

          // Coverage tally (independent of whether we write).
          for (const d of DIMS) {
            const src = sources[d];
            if (src) coverage[src][d]++;
          }

          const changed =
            tag_source !== c.tag_source ||
            unique_code !== (c.unique_code ?? null) ||
            needs_review !== (c.needs_tag_review ?? false) ||
            DIMS.some((d) => (tags[d] ?? null) !== (c[d as keyof typeof c] ?? null));

          // NO-DEMOTE: never rewrite a legacy auto row down to 'untagged'.
          if (tag_source === "untagged" && (c.tag_source === "inferred" || c.tag_source === "csv")) {
            totals.protected++;
            continue;
          }
          if (!changed) { totals.unchanged++; continue; }
          if (needs_review) totals.flagged++;

          updates.push({
            ad_id: c.ad_id,
            update: {
              tag_source,
              unique_code,
              needs_tag_review: needs_review,
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
        totals.updated += updates.length; // would-update count
        continue;
      }

      // Apply — batch by identical update signature to cut round-trips, chunked
      // to keep each statement's IN(...) list pooler-safe.
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
          if (upErr) { totals.errors += chunk.length; }
          else { totals.updated += (upData?.length ?? chunk.length); }
        }
      }

      // Refresh the account's untagged_count (AI tags can only reduce it).
      if (accountDrained && !dryRun) {
        const { count } = await supabase
          .from("creatives")
          .select("*", { count: "exact", head: true })
          .eq("account_id", accountId)
          .eq("tag_source", "untagged");
        await supabase.from("ad_accounts").update({ untagged_count: count || 0 }).eq("id", accountId);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      drained,
      accounts: accountIds.length,
      totals,
      coverage,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("backfill-ai-tags error:", errorMessage(e));
    return new Response(JSON.stringify({ error: "Internal server error", detail: errorMessage(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── ONGOING HOOK (follow-up, not wired here) ──────────────────────────────────
// New creatives get AI tags the moment they are analyzed by wiring the SAME
// derivation into analyze-creative. After it builds the framework columns
// (buildFrameworkColumns) it already has fw.hook_type / fw.value_structure /
// framework_json + the hasVideo flag in scope, plus the account convention. One
// call —
//     computeAutoTags({ parsed: parsedDisplayTags(parseAdName(ad_name, convention)),
//                        ai: { hook_type, value_structure, framework_json, isVideo: hasVideo },
//                        nameMapping, manual: <current manual tags or null> })
// — then merge tags + tag_source + needs_tag_review into the same update object
// analyze-creative already writes. That file is owned by another agent this pass,
// so it is intentionally left untouched; the derivation + this backfill are the
// mechanism, and the hook is a ~10-line addition once the file is free.
