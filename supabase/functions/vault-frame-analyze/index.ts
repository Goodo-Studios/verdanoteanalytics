// vault-frame-analyze — port from Creative Vault (US-003).
// Differences from source:
//   • No workspace_id references. Auth check stays: this endpoint is callable
//     from the browser when a user is inspecting a video frame-by-frame, so we
//     verify the user JWT manually with the anon-key client.
//
// Pipeline role: given up to 8 base64 frame snapshots from a short-form video,
// asks Claude to describe each frame (setting, subject, on-screen text). Used
// by the frontend hook-frame inspector — no DB writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLAUDE_MODEL = "anthropic/claude-sonnet-4-6";

interface Frame {
  timestamp: number; // seconds
  dataUrl: string;   // base64 data:image/jpeg;base64,...
}

async function analyzeFrames(frames: Frame[]): Promise<Array<{ timestamp: number; description: string }>> {
  const imageContent = frames.map((f) => ({
    type: "image_url",
    image_url: { url: f.dataUrl, detail: "low" },
  }));

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Verdanote",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content:
            "You are analyzing video frames from a short-form social media video. For each frame, describe in one sentence what is happening: the setting, subject, and any visible text overlays. Focus on visual elements that tell the story of the video's structure.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze these ${frames.length} video frames captured at timestamps: ${frames.map((f) => `${f.timestamp}s`).join(", ")}. For each frame in order, give a single descriptive sentence. Respond as a JSON array: [{"timestamp": 0, "description": "..."}]`,
            },
            ...imageContent,
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Vision API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "[]";

  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    return frames.map((f) => ({ timestamp: f.timestamp, description: `Frame at ${f.timestamp}s` }));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { frames } = await req.json() as { frames: Frame[] };
  if (!frames?.length) return json({ error: "frames array required" }, 400);
  if (frames.length > 8) return json({ error: "Maximum 8 frames per request" }, 400);

  const results = await analyzeFrames(frames);
  return json({ frames: results });
});
