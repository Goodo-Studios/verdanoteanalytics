import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";


const CODA_DOC_ID = "Edw6ZW63pk";
const CODA_TABLE_ID = "grid-MEOygYxxim";

// Map granular Coda stages → display stages for the pipeline UI.
// Reconciled 2026-05-31 against the live Coda Stage distribution (11226 rows).
// Drift fixes:
//   - "Export Versions" (stale, no longer in Coda) → replaced by "Versions Exported".
//   - "Ready for transfer" (stale, no longer in Coda) → removed.
//   - "Not Started" → Planning (new live value).
// Terminal stages (TERMINAL_DISPLAY_STAGES below) map to "Complete" and are
// excluded from the active-pipeline upsert.
const STAGE_MAP: Record<string, string> = {
  "Not Started": "Planning",
  "Brief Creation": "Planning",
  "Client Brief Review": "Planning",
  "Assigned": "Planning",
  "Ready for Creator": "Production",
  "Ready to Shoot": "Production",
  "Shooting Content": "Production",
  "Working On It (Admin/Production)": "Production",
  "Ready to Edit": "Production",
  "Editing": "Production",
  "Versions Exported": "Production",
  "STUCK": "Production",
  "Internal Review": "Review",
  "Internal Review Edits": "Review",
  "Ready to Send to Client": "Your Review",
  "Client Review": "Your Review",
  "Client Revisions": "Your Review",
  "Ready to Launch": "Complete",
};

// Display stages considered terminal for a live pipeline view. A task whose
// resolved display stage is in this set is NOT relevant to the active pipeline
// and is skipped at sync time (keeps coda_tasks small). "Ready to Launch"
// (~6717 rows) resolves to "Complete" and is the dominant terminal case.
const TERMINAL_DISPLAY_STAGES = new Set<string>(["Complete"]);

// Raw Coda stages explicitly skipped at sync time (operator decision): rows
// that are not part of any live pipeline. We do NOT upsert these — dropping
// them at sync time keeps the coda_tasks table small rather than carrying dead
// rows. Empty/null Stage rows (~2192) are handled separately in the loop.
const SKIP_RAW_STAGES = new Set<string>(["Not applicable anymore"]);

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Decide whether a Coda row should be synced into coda_tasks (active pipeline).
// "Active" = has a non-empty Stage, is not an explicitly-skipped raw stage, and
// does not resolve to a terminal display stage (e.g. "Complete"). Unknown
// stages (not in STAGE_MAP) fall through as their raw string and are treated as
// active so genuinely new in-progress stages are not silently dropped.
function isActiveStage(rawStage: string | null): boolean {
  if (!rawStage) return false; // empty/null Stage → not active
  if (SKIP_RAW_STAGES.has(rawStage)) return false;
  const display = STAGE_MAP[rawStage] || rawStage;
  return !TERMINAL_DISPLAY_STAGES.has(display);
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Build account_name → account_id lookup (fuzzy)
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
      // Exact normalised match
      if (accountLookup[key]) return accountLookup[key];
      // Substring match (either direction)
      for (const [k, id] of Object.entries(accountLookup)) {
        if (key.includes(k) || k.includes(key)) return id;
      }
      return null;
    }

    // Fetch all rows from Coda table (paginated)
    let allRows: any[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        `https://coda.io/apis/v1/docs/${CODA_DOC_ID}/tables/${CODA_TABLE_ID}/rows`
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

    // Upsert into coda_tasks
    let upserted = 0;
    let skipped = 0;
    const unknownStages = new Set<string>();
    for (const row of allRows) {
      const vals = row.values || {};
      const codaRowId = row.id;
      const rawStage = vals["Stage"] || null;
      const accountName = vals["Connected Project"] || null;

      // Active-task filtering: skip terminal / empty / not-applicable rows so
      // coda_tasks only holds live-pipeline tasks (operator decision).
      if (!isActiveStage(rawStage)) {
        skipped++;
        continue;
      }

      // Stage-drift visibility: any Coda stage not in STAGE_MAP still falls
      // through as its raw string (preserved behavior) but is logged so future
      // drift is surfaced.
      if (rawStage && !(rawStage in STAGE_MAP)) {
        unknownStages.add(rawStage);
      }

      const record: Record<string, any> = {
        coda_row_id: codaRowId,
        account_name: accountName,
        account_id: resolveAccountId(accountName),
        task_name: vals["Task"] || null,
        brief: vals["Brief"] || null,
        stage: rawStage ? (STAGE_MAP[rawStage] || rawStage) : null,
        due_date: vals["Due Date"] || null,
        content_type: vals["Content Type"] || vals["Asset Type"] || null,
        coda_url: row.browserLink || null,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("coda_tasks")
        .upsert(record, { onConflict: "coda_row_id" });

      if (error) {
        console.error(`Upsert error for row ${codaRowId}:`, error.message);
      } else {
        upserted++;
      }
    }

    console.log(
      `Upserted ${upserted} active rows, skipped ${skipped} (terminal/empty/not-applicable), of ${allRows.length} total`
    );
    if (unknownStages.size > 0) {
      console.warn(
        `Coda STAGE_MAP drift: unmapped stages passed through as raw strings: ${[
          ...unknownStages,
        ].join(", ")}`
      );
    }

    return new Response(
      JSON.stringify({ success: true, total: allRows.length, upserted, skipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("sync-coda-tasks error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
