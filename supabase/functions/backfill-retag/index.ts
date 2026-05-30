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
// IDEMPOTENT + PROGRESSIVELY DRAINABLE: a row is written only when its resolved
// tags actually differ from what's stored. Rows that flip to parsed/csv_match
// leave the gate permanently; genuinely-untaggable rows stay 'untagged' and the
// actionable set shrinks each run. A per-invocation time budget bounds work and
// returns { drained } so a caller can re-invoke until drained === true.
//
// Stored tag columns hold DISPLAY names, so the parser's canonical vocab is
// mapped through toDisplayName before it enters the resolver (same contract as
// creatives/index.ts, sync/index.ts, sync-coda-names/index.ts).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveConvention, type NamingConvention } from "../_shared/naming-convention.ts";
import { parseAdName, type ParsedAdName, type AdNameTags } from "../_shared/parse-ad-name.ts";
import { resolveTags, type PartialTags } from "../_shared/resolve-tags.ts";

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

interface Counters { scanned: number; updated: number; unchanged: number; still_untagged: number; errors: number; }
function newCounters(): Counters { return { scanned: 0, updated: 0, unchanged: 0, still_untagged: 0, errors: 0 }; }

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

    const perAccount = new Map<string, Counters>();
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
            counters.still_untagged++;
            // A row stuck at the legacy 'csv'/'inferred' source with no resolvable
            // tags is normalised to the new canonical 'untagged' (a real change);
            // an already-'untagged' row with no change is left alone.
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
        continue;
      }

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

    const totals = [...perAccount.values()].reduce(
      (acc, c) => ({
        scanned: acc.scanned + c.scanned,
        updated: acc.updated + c.updated,
        unchanged: acc.unchanged + c.unchanged,
        still_untagged: acc.still_untagged + c.still_untagged,
        errors: acc.errors + c.errors,
      }),
      newCounters(),
    );

    const summary = {
      success: true,
      dry_run: dryRun,
      drained,
      accounts_processed: perAccount.size,
      totals,
      per_account: Object.fromEntries([...perAccount.entries()].map(([id, c]) => [id, c])),
    };
    console.log("backfill-retag:", JSON.stringify({ ...summary, per_account: undefined }));
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
