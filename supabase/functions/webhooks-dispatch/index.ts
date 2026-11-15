import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApiAuth, corsHeaders } from "../_shared/api-auth.ts";
import { matchWebhooks } from "../_shared/webhook-match.ts";
import { safeErrorResponse } from "../_shared/safe-error.ts";
import { isStaffUser } from "../_shared/account-access.ts";
import { dispatchScopeError, postWebhook } from "../_shared/webhook-dispatch.ts";

async function sendWebhook(
  webhook: { id: string; url: string; secret: string | null },
  payload: Record<string, unknown>,
  supabase: any
) {
  // Public destinations only, no redirects (audit 2.1); 0 means refused or a network error.
  const statusCode = await postWebhook(webhook, JSON.stringify(payload));

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
  withApiAuth(async (req, { userId, permissions }) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Agency staff (builder/employee) may dispatch to any account and to the
    // "global" webhooks (those with no account_ids). Memoised — used to gate the
    // paths that would otherwise let any key reach another tenant's webhook.
    let staffChecked = false;
    let staffCached = false;
    const callerIsStaff = async (): Promise<boolean> => {
      if (staffChecked) return staffCached;
      // isStaffUser reads one role through get_user_role; the old .maybeSingle() errored for a
      // user who is both builder and employee and treated them as non-staff.
      staffCached = await isStaffUser(supabase, userId);
      staffChecked = true;
      return staffCached;
    };

    const scopeError = dispatchScopeError(permissions);
    if (scopeError) {
      return new Response(JSON.stringify({ error: scopeError }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        const { data: link } = await supabase
          .from("user_accounts")
          .select("account_id")
          .eq("user_id", userId)
          .eq("account_id", account_id)
          .maybeSingle();

        // Also allow builders/employees who have no user_accounts rows but have
        // elevated role — check user_roles as fallback.
        if (!link) {
          if (!(await callerIsStaff())) {
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
            if (!(await callerIsStaff())) {
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
        } else if (!(await callerIsStaff())) {
          // A webhook with no account_ids is a "global" webhook. Previously the
          // empty-account_ids case skipped the ownership check entirely, letting
          // any key test-dispatch to another tenant's global webhook. Require staff.
          return new Response(
            JSON.stringify({ error: "Forbidden: you do not have access to this webhook" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Non-test dispatch with no account_id fans out to every "global" webhook
      // (those with empty account_ids). That is a staff-only operation — without
      // this gate any key could broadcast attacker-controlled data (signed with
      // each webhook's secret) to every tenant's global webhook.
      if (!test_webhook_id && !account_id && !(await callerIsStaff())) {
        return new Response(
          JSON.stringify({ error: "Forbidden: account_id is required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Non-staff callers only reach webhooks that list their account; global webhooks are staff only.
      const matching = matchWebhooks(webhooks || [], {
        accountId: account_id,
        testWebhookId: test_webhook_id,
        isStaff: await callerIsStaff(),
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
      return safeErrorResponse(e, corsHeaders, { context: "webhooks-dispatch error" });
    }
  })
);
