// Use SITE_URL env var to restrict CORS to the known frontend origin.
// Internal-only functions (webhooks-dispatch, sync) never need a browser wildcard.
// Falls back to "*" only when SITE_URL is not set (local dev without env vars).
export const corsHeaders = {
  "Access-Control-Allow-Origin": (typeof Deno !== "undefined" ? Deno.env.get("SITE_URL") : undefined) || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

// JSON response helper used by vault-* edge functions (ported from Creative Vault).
// Returns a Response with corsHeaders + Content-Type: application/json applied.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
