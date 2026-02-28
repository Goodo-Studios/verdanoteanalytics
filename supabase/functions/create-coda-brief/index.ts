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
    if (!CODA_API_KEY) {
      throw new Error("CODA_API_KEY is not configured");
    }

    const { creative_id, account_id, account_name, task_name, brief_note, user_id } =
      await req.json();

    if (!account_id || !account_name) {
      return new Response(
        JSON.stringify({ error: "account_id and account_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optionally enrich with creative data
    let creativeName = "";
    let creativeRoas = "";
    let creativeSpend = "";
    let creativeAdType = "";

    if (creative_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: creative } = await supabase
        .from("creatives")
        .select("ad_name, roas, spend, ad_type, hook, theme, style")
        .eq("ad_id", creative_id)
        .single();

      if (creative) {
        creativeName = creative.ad_name || "";
        creativeRoas = creative.roas != null ? `${creative.roas}x` : "";
        creativeSpend = creative.spend != null ? `$${creative.spend}` : "";
        creativeAdType = creative.ad_type || "";
      }
    }

    // Push row to Coda
    const codaRes = await fetch(
      `https://coda.io/apis/v1/docs/${CODA_DOC_ID}/tables/${CODA_TABLE_ID}/rows`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CODA_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rows: [
            {
              cells: [
                { column: "Task", value: task_name || "" },
                { column: "Connected Project", value: account_name },
                { column: "Brief", value: brief_note || "" },
              ],
            },
          ],
        }),
      }
    );

    const codaBody = await codaRes.text();

    if (!codaRes.ok) {
      throw new Error(`Coda API error [${codaRes.status}]: ${codaBody}`);
    }

    return new Response(
      JSON.stringify({ success: true, coda: JSON.parse(codaBody) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("create-coda-brief error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
