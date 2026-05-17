import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApiAuth, corsHeaders } from "../_shared/api-auth.ts";

async function hmacSign(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendWebhook(
  webhook: { id: string; url: string; secret: string | null },
  payload: Record<string, unknown>,
  supabase: any
) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Verdanote-Webhooks/1.0",
  };

  if (webhook.secret) {
    headers["X-Verdanote-Signature"] = await hmacSign(webhook.secret, body);
  }

  let statusCode = 0;
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
    statusCode = res.status;
    await res.text(); // consume body
  } catch (e) {
    statusCode = 0; // network error
    console.error(`Webhook ${webhook.id} failed:`, e);
  }

  // Update last triggered info
  await supabase
    .from("webhooks")
    .update({
      last_triggered_at: new Date().toISOString(),
      last_status_code: statusCode,
    })
    .eq("id", webhook.id);
}

Deno.serve(
  withApiAuth(async (req, { userId }) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    try {
      const { event, account_id, account_name, data, test_webhook_id } =
        await req.json();

      if (!event) {
        return new Response(JSON.stringify({ error: "event is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify the caller owns the account_id they are dispatching for.
      // Builders/employees may dispatch for any account; clients must have a
      // user_accounts row linking them to the account.
      if (account_id) {
        const { data: link, error: linkError } = await supabase
          .from("user_accounts")
          .select("account_id")
          .eq("user_id", userId)
          .eq("account_id", account_id)
          .maybeSingle();

        // Also allow builders/employees who have no user_accounts rows but have
        // elevated role — check user_roles as fallback.
        if (!link) {
          const { data: roleRow } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .in("role", ["builder", "employee"])
            .maybeSingle();

          if (!roleRow) {
            return new Response(
              JSON.stringify({
                error: "Forbidden: you do not have access to this account",
              }),
              {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
        }
      }

      const payload = {
        event,
        timestamp: new Date().toISOString(),
        account_id: account_id || null,
        account_name: account_name || null,
        data: data || {},
      };

      // If test_webhook_id is set, only send to that specific webhook
      let query = supabase
        .from("webhooks")
        .select("id, url, secret, events, account_ids, is_active");

      if (test_webhook_id) {
        query = query.eq("id", test_webhook_id);
      } else {
        query = query.eq("is_active", true).contains("events", [event]);
      }

      const { data: webhooks, error } = await query;
      if (error) throw error;

      // For test dispatch: verify the target webhook belongs to an account the
      // caller is allowed to access.
      if (test_webhook_id && webhooks && webhooks.length > 0) {
        const targetWebhook = webhooks[0];
        const webhookAccountIds: string[] = targetWebhook.account_ids || [];

        if (webhookAccountIds.length > 0) {
          // Check caller has access to at least one of the webhook's accounts
          const { data: userLinks } = await supabase
            .from("user_accounts")
            .select("account_id")
            .eq("user_id", userId)
            .in("account_id", webhookAccountIds);

          const hasAccountAccess = userLinks && userLinks.length > 0;

          if (!hasAccountAccess) {
            // Fall back to role check
            const { data: roleRow } = await supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", userId)
              .in("role", ["builder", "employee"])
              .maybeSingle();

            if (!roleRow) {
              return new Response(
                JSON.stringify({
                  error: "Forbidden: you do not have access to this webhook",
                }),
                {
                  status: 403,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                }
              );
            }
          }
        }
      }

      const matching = (webhooks || []).filter((wh: any) => {
        if (test_webhook_id) return true; // bypass filters for test
        // If account_ids is empty, match all accounts
        if (!wh.account_ids || wh.account_ids.length === 0) return true;
        return account_id && wh.account_ids.includes(account_id);
      });

      const results = await Promise.allSettled(
        matching.map((wh: any) => sendWebhook(wh, payload, supabase))
      );

      return new Response(
        JSON.stringify({
          dispatched: matching.length,
          results: results.map((r) =>
            r.status === "fulfilled" ? "ok" : r.reason?.message || "error"
          ),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (e: any) {
      console.error("webhooks-dispatch error:", e);
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
