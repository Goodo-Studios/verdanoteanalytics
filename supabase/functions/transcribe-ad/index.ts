import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");

    if (!deepgramKey) {
      return json({ success: false, error: "DEEPGRAM_API_KEY not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const { ad_id, video_url } = body;

    if (!ad_id || !video_url) {
      return json({ success: false, error: "ad_id and video_url are required" }, 400);
    }

    // Mark as processing
    await supabase
      .from("ad_library_saved_ads")
      .update({ transcript_status: "processing" } as any)
      .eq("id", ad_id);

    try {
      // Call Deepgram with URL method (avoids downloading the video ourselves)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const dgResponse = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&paragraphs=true",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${deepgramKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: video_url }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (!dgResponse.ok) {
        const errText = await dgResponse.text();
        console.error("Deepgram error:", dgResponse.status, errText);
        throw new Error(`Deepgram API error: ${dgResponse.status}`);
      }

      const dgData = await dgResponse.json();

      // Extract transcript — prefer paragraphed version
      let transcript = "";
      const channel = dgData?.results?.channels?.[0]?.alternatives?.[0];
      if (channel) {
        transcript =
          channel?.paragraphs?.transcript ||
          channel?.transcript ||
          "";
      }

      if (!transcript) {
        throw new Error("No transcript returned from Deepgram");
      }

      // Update ad with transcript
      await supabase
        .from("ad_library_saved_ads")
        .update({
          transcript,
          transcript_status: "completed",
        } as any)
        .eq("id", ad_id);

      return json({ success: true, transcript });
    } catch (e) {
      console.error("Transcription failed:", e);

      await supabase
        .from("ad_library_saved_ads")
        .update({ transcript_status: "failed" } as any)
        .eq("id", ad_id);

      return json({
        success: false,
        error: e instanceof Error ? e.message : "Transcription failed",
      }, 500);
    }
  } catch (e) {
    console.error("transcribe-ad error:", e);
    return json({ success: false, error: "Internal error" }, 500);
  }
});
