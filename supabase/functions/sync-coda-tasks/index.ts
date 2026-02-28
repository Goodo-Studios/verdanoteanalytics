import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CODA_DOC_ID = "Edw6ZW63pk";
const CODA_TABLE_ID = "grid-MEOygYxxim";

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

      const record = {
        coda_row_id: codaRowId,
        account_name: vals["Connected Project"] || null,
        account_id: vals["Account ID"] || null,
        task_name: vals["Task"] || null,
        brief: vals["Brief"] || null,
        creative_id: vals["Creative ID"] || null,
        creative_name: vals["Creative Name"] || null,
        ad_type: vals["Ad Type"] || null,
        roas: vals["ROAS"] || null,
        spend: vals["Spend"] || null,
        status: vals["Status"] || "pending",
        created_by: null, // Coda stores user_id as string, skip FK
        coda_created_at: vals["Created At"] || null,
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
