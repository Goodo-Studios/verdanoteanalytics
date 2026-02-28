import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CODA_DOC_ID = "Edw6ZW63pk";
const CODA_TABLE_ID = "grid-MEOygYxxim";

// Map granular Coda stages → display stages for the pipeline UI
const STAGE_MAP: Record<string, string> = {
  "Brief Creation": "Planning",
  "Client Brief Review": "Planning",
  "Assigned": "Planning",
  "Ready for Creator": "Production",
  "Ready to Shoot": "Production",
  "Shooting Content": "Production",
  "Working On It (Admin/Production)": "Production",
  "Ready to Edit": "Production",
  "Editing": "Production",
  "Export Versions": "Production",
  "STUCK": "Production",
  "Internal Review": "Review",
  "Internal Review Edits": "Review",
  "Ready to Send to Client": "Your Review",
  "Client Review": "Your Review",
  "Client Revisions": "Your Review",
  "Ready for transfer": "Complete",
  "Ready to Launch": "Complete",
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    for (const row of allRows) {
      const vals = row.values || {};
      const codaRowId = row.id;
      const rawStage = vals["Stage"] || null;
      const accountName = vals["Connected Project"] || null;

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

    console.log(`Upserted ${upserted}/${allRows.length} rows`);

    return new Response(
      JSON.stringify({ success: true, total: allRows.length, upserted }),
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
