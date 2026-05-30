// US-004: Scheduled GET-only Coda ad-name -> name_mappings sync.
//
// Reads the Coda "Goodo Ad Name" column from the tasks grid (GET-only, never
// writes to Coda), runs each ad name through the canonical parser (US-002)
// against the resolved account's naming convention, and upserts the resulting
// canonical tags into name_mappings ON CONFLICT (account_id, unique_code).
//
// Manual-override protection is STRUCTURAL: this job writes ONLY name_mappings
// (the csv/Coda tier). It never touches the creatives table. The single
// precedence resolver (_shared/resolve-tags.ts: manual > csv_match > parsed >
// untagged) guarantees a manual edit on a creative always wins over whatever
// this job writes into name_mappings.
//
// Stored tag columns hold DISPLAY names, so the parser's canonical vocab is
// mapped through toDisplayName before it is written (same contract as
// creatives/index.ts and sync/index.ts).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveConvention, type NamingConvention } from "../_shared/naming-convention.ts";
import { parseAdName } from "../_shared/parse-ad-name.ts";

const CODA_DOC_ID = "Edw6ZW63pk";
const CODA_TABLE_ID = "grid-MEOygYxxim";
const CODA_AD_NAME_COL = "Goodo Ad Name";
const CODA_ACCOUNT_COL = "Connected Project";

// Canonical vocab -> display name. Duplicated from creatives/index.ts per the
// HQ learned rule (prefer duplication over a shared extraction needing 5+ wired files).
const DISPLAY_NAMES: Record<string, string> = {
  UGCNative: "UGC Native", StudioClean: "Studio Clean", TextForward: "Text Forward",
  NoTalent: "No Talent", ProblemCallout: "Problem Callout", StatementBold: "Statement Bold",
  AuthorityIntro: "Authority Intro", BeforeAndAfter: "Before & After", PatternInterrupt: "Pattern Interrupt",
};
function toDisplayName(val: string): string { return DISPLAY_NAMES[val] || val; }

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface MappingRow {
  account_id: string;
  unique_code: string;
  ad_type: string | null;
  person: string | null;
  style: string | null;
  product: string | null;
  hook: string | null;
  theme: string | null;
  updated_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const CODA_API_KEY = Deno.env.get("CODA_API_KEY");
    if (!CODA_API_KEY) throw new Error("CODA_API_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── account_name -> account_id lookup (fuzzy), same as sync-coda-tasks ──
    const { data: accounts } = await supabase
      .from("ad_accounts")
      .select("id, name")
      .eq("is_active", true);

    const accountLookup: Record<string, string> = {};
    for (const a of accounts || []) {
      accountLookup[normalise(a.name)] = a.id;
    }

    function resolveAccountId(codaName: string | null): string | null {
      if (!codaName) return null;
      const key = normalise(codaName);
      if (accountLookup[key]) return accountLookup[key];
      for (const [k, id] of Object.entries(accountLookup)) {
        if (key.includes(k) || k.includes(key)) return id;
      }
      return null;
    }

    // ── Fetch all ad-name rows from Coda (GET-only, cursor-paginated) ──
    let allRows: any[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(
        `https://coda.io/apis/v1/docs/${CODA_DOC_ID}/tables/${CODA_TABLE_ID}/rows`,
      );
      url.searchParams.set("useColumnNames", "true");
      url.searchParams.set("limit", "500");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${CODA_API_KEY}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Coda API error [${res.status}]: ${body}`);
      }
      const data = await res.json();
      allRows = allRows.concat(data.items || []);
      pageToken = data.nextPageToken;
    } while (pageToken);

    console.log(`Fetched ${allRows.length} rows from Coda`);

    // ── Resolve, parse, and group upserts per account ──
    const conventionCache = new Map<string, NamingConvention | null>();
    async function conventionFor(accountId: string): Promise<NamingConvention | null> {
      if (conventionCache.has(accountId)) return conventionCache.get(accountId)!;
      const conv = await resolveConvention(supabase, accountId);
      conventionCache.set(accountId, conv);
      return conv;
    }

    // Per-account counters for sync_logs.
    interface Counters { fetched: number; upserted: number; parsed: number; untagged: number; errors: number; }
    const perAccount = new Map<string, Counters>();
    function bump(accountId: string): Counters {
      let c = perAccount.get(accountId);
      if (!c) { c = { fetched: 0, upserted: 0, parsed: 0, untagged: 0, errors: 0 }; perAccount.set(accountId, c); }
      return c;
    }

    // Dedupe by (account_id, unique_code) — last row wins within a run.
    const pending = new Map<string, MappingRow>();

    for (const row of allRows) {
      const vals = row.values || {};
      const adName: string = (vals[CODA_AD_NAME_COL] ?? "").toString().trim();
      const accountName = vals[CODA_ACCOUNT_COL] ?? null;
      if (!adName) continue;

      const accountId = resolveAccountId(accountName);
      if (!accountId) continue; // can't attribute to an account -> skip

      const counters = bump(accountId);
      counters.fetched++;

      const convention = await conventionFor(accountId);
      if (!convention) continue; // no convention configured -> nothing to parse against

      const parsed = parseAdName(adName, convention);
      const uniqueCode = parsed.unique_code;
      if (!uniqueCode) continue; // empty unique_code -> skip

      const t = parsed.tags;
      const mapped = {
        ad_type: t.ad_type ? toDisplayName(t.ad_type) : null,
        person: t.person ? toDisplayName(t.person) : null,
        style: t.style ? toDisplayName(t.style) : null,
        product: t.product,
        hook: t.hook ? toDisplayName(t.hook) : null,
        theme: t.theme,
      };

      const hasAnyTag = Object.values(mapped).some((v) => v != null && v !== "");
      if (!hasAnyTag) { counters.untagged++; continue; } // parsed but produced no tags

      counters.parsed++;
      pending.set(`${accountId}::${uniqueCode}`, {
        account_id: accountId,
        unique_code: uniqueCode,
        ...mapped,
        updated_at: new Date().toISOString(),
      });
    }

    // ── Upsert into name_mappings ON CONFLICT (account_id, unique_code) ──
    for (const rec of pending.values()) {
      const { error } = await supabase
        .from("name_mappings")
        .upsert(rec, { onConflict: "account_id,unique_code" });
      if (error) {
        console.error(`name_mappings upsert error [${rec.account_id}/${rec.unique_code}]:`, error.message);
        bump(rec.account_id).errors++;
      } else {
        bump(rec.account_id).upserted++;
      }
    }

    // ── Record one sync_logs row per account ──
    const nowIso = new Date().toISOString();
    for (const [accountId, c] of perAccount.entries()) {
      const status = c.errors > 0 ? "completed_with_errors" : "completed";
      const { error: logErr } = await supabase.from("sync_logs").insert({
        account_id: accountId,
        sync_type: "daily",
        status,
        creatives_fetched: c.fetched,
        creatives_upserted: c.upserted,
        tags_parsed: c.parsed,
        tags_csv_matched: 0,
        tags_manual_preserved: 0,
        tags_untagged: c.untagged,
        api_errors: c.errors,
        started_at: nowIso,
        completed_at: new Date().toISOString(),
      });
      if (logErr) console.error(`sync_logs insert error [${accountId}]:`, logErr.message);
    }

    const summary = {
      success: true,
      coda_rows: allRows.length,
      accounts_touched: perAccount.size,
      mappings_upserted: [...perAccount.values()].reduce((s, c) => s + c.upserted, 0),
    };
    console.log("sync-coda-names:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("sync-coda-names error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
