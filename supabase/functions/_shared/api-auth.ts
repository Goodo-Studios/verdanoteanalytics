import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validateApiKey(key: string) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const keyHash = await hashKey(key);

  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .single();

  if (error || !apiKey) {
    return { valid: false as const, error: "Invalid API key" };
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return { valid: false as const, error: "API key expired" };
  }

  // Fire-and-forget update last_used_at
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then(() => {});

  return {
    valid: true as const,
    userId: apiKey.user_id as string,
    permissions: apiKey.permissions as string[],
    keyId: apiKey.id as string,
  };
}

function extractApiKey(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.replace("Bearer ", "");
  return req.headers.get("x-api-key");
}

// Durable, cross-instance rate limit backed by the api_rate_limit_counters
// table via the check_api_rate_limit() SECURITY DEFINER function. Limit and
// window are env-configurable (no per-call-site edits): API_RATE_LIMIT (default
// 100), API_RATE_LIMIT_WINDOW_SECONDS (default 60). Returns the window length
// in seconds when the request is over the limit, or null when allowed.
// Fails open on RPC error so a counter outage cannot take the API down.
export async function checkRateLimit(keyId: string): Promise<number | null> {
  const limit = parseInt(Deno.env.get("API_RATE_LIMIT") ?? "100", 10);
  const windowSeconds = parseInt(Deno.env.get("API_RATE_LIMIT_WINDOW_SECONDS") ?? "60", 10);

  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabase.rpc("check_api_rate_limit", {
    p_key_id: keyId,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  // Fail open: never block traffic on a counter/RPC failure.
  if (error) return null;
  return data === false ? windowSeconds : null;
}

export function withApiAuth(
  handler: (req: Request, ctx: { userId: string; permissions: string[]; keyId: string }) => Promise<Response>
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const apiKey = extractApiKey(req);
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing API key. Use x-api-key header or Authorization: Bearer <key>" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validation = await validateApiKey(apiKey);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const retryAfter = await checkRateLimit(validation.keyId);
    if (retryAfter !== null) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded" }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        }
      );
    }

    return handler(req, { userId: validation.userId, permissions: validation.permissions, keyId: validation.keyId });
  };
}

export { corsHeaders };
