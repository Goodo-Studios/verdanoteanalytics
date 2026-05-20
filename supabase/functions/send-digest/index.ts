import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // Use service role to fetch data
    const admin = createClient(supabaseUrl, serviceKey);

    // Get user preferences
    const { data: prefs } = await admin
      .from("user_preferences")
      .select("digest_enabled, digest_day, digest_accounts, last_digest_sent_at")
      .eq("user_id", userId)
      .single();

    if (!prefs?.digest_enabled) {
      return new Response(
        JSON.stringify({ error: "Digest is disabled for this user" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const digestAccounts: string[] = prefs.digest_accounts || [];

    // Get user's email
    const { data: profile } = await admin
      .from("profiles")
      .select("email, display_name")
      .eq("user_id", userId)
      .single();

    if (!profile?.email) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get account details
    let accountQuery = admin.from("ad_accounts").select("id, name, logo_url");
    if (digestAccounts.length > 0) {
      accountQuery = accountQuery.in("id", digestAccounts);
    }
    const { data: accounts } = await accountQuery;

    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No accounts selected for digest" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Date range: last 7 days
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const dateStr = `${weekAgo.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    // Build per-account summaries
    const accountSections: string[] = [];
    for (const account of accounts) {
      // This week metrics
      const { data: thisWeek } = await admin
        .from("creative_daily_metrics")
        .select("spend, roas, ad_id")
        .eq("account_id", account.id)
        .gte("date", weekAgo.toISOString().split("T")[0])
        .lte("date", now.toISOString().split("T")[0]);

      // Last week metrics (for trend)
      const { data: lastWeek } = await admin
        .from("creative_daily_metrics")
        .select("spend, roas")
        .eq("account_id", account.id)
        .gte("date", twoWeeksAgo.toISOString().split("T")[0])
        .lt("date", weekAgo.toISOString().split("T")[0]);

      const thisWeekSpend = (thisWeek || []).reduce((s, r) => s + (Number(r.spend) || 0), 0);
      const thisWeekRoas =
        (thisWeek || []).length > 0
          ? (thisWeek || []).reduce((s, r) => s + (Number(r.roas) || 0), 0) / (thisWeek || []).length
          : 0;

      const lastWeekSpend = (lastWeek || []).reduce((s, r) => s + (Number(r.spend) || 0), 0);
      const lastWeekRoas =
        (lastWeek || []).length > 0
          ? (lastWeek || []).reduce((s, r) => s + (Number(r.roas) || 0), 0) / (lastWeek || []).length
          : 0;

      // Top creative by ROAS this week
      const { data: topCreative } = await admin
        .from("creatives")
        .select("ad_name, thumbnail_url, roas")
        .eq("account_id", account.id)
        .order("roas", { ascending: false })
        .limit(1)
        .single();

      // Trends
      const spendChange = lastWeekSpend > 0 ? ((thisWeekSpend - lastWeekSpend) / lastWeekSpend) * 100 : 0;
      const roasChange = lastWeekRoas > 0 ? ((thisWeekRoas - lastWeekRoas) / lastWeekRoas) * 100 : 0;
      const spendArrow = spendChange >= 0 ? "▲" : "▼";
      const roasArrow = roasChange >= 0 ? "▲" : "▼";
      const spendColor = spendChange >= 0 ? "#16a34a" : "#dc2626";
      const roasColor = roasChange >= 0 ? "#16a34a" : "#dc2626";

      const topCreativeThumbnail = topCreative?.thumbnail_url
        ? `<img src="${topCreative.thumbnail_url}" alt="" style="width:48px;height:48px;border-radius:6px;object-fit:cover;" />`
        : `<div style="width:48px;height:48px;border-radius:6px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:18px;color:#94a3b8;">🎨</div>`;

      accountSections.push(`
        <tr><td style="padding:24px 0 8px 0;">
          <h2 style="margin:0;font-size:18px;font-weight:700;color:#1a2e1a;">${account.name}</h2>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 12px 0;">
            <tr>
              <td style="padding:12px 16px;background:#f8faf8;border-radius:8px;text-align:center;width:33%;">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Spend</div>
                <div style="font-size:20px;font-weight:700;color:#1a2e1a;margin-top:4px;">$${thisWeekSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:12px 16px;background:#f8faf8;border-radius:8px;text-align:center;width:33%;">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">ROAS</div>
                <div style="font-size:20px;font-weight:700;color:#1a2e1a;margin-top:4px;">${thisWeekRoas.toFixed(2)}x</div>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:12px 16px;background:#f8faf8;border-radius:8px;width:33%;">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Top Creative</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                  ${topCreativeThumbnail}
                  <div>
                    <div style="font-size:12px;color:#1a2e1a;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${topCreative?.ad_name || "—"}</div>
                    ${topCreative?.roas ? `<span style="display:inline-block;margin-top:2px;font-size:10px;font-weight:600;color:#16a34a;background:#dcfce7;padding:1px 6px;border-radius:99px;">${Number(topCreative.roas).toFixed(2)}x</span>` : ""}
                  </div>
                </div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 0 16px 0;">
          <div style="font-size:13px;color:#475569;">
            <span style="color:${roasColor};font-weight:600;">${roasArrow} ROAS ${roasChange >= 0 ? "up" : "down"} ${Math.abs(roasChange).toFixed(0)}%</span> from last week
            &nbsp;·&nbsp;
            <span style="color:${spendColor};font-weight:600;">${spendArrow} Spend ${spendChange >= 0 ? "up" : "down"} ${Math.abs(spendChange).toFixed(0)}%</span>
          </div>
        </td></tr>
        <tr><td style="padding:0;"><div style="border-top:1px solid #e2e8f0;"></div></td></tr>
      `);
    }

    const siteUrl = req.headers.get("origin") || Deno.env.get("APP_URL") || "https://verdanote.com";

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <tr><td style="text-align:center;padding-bottom:24px;">
      <div style="font-size:22px;font-weight:800;color:#1a2e1a;letter-spacing:-0.5px;">🌿 Verdanote</div>
      <div style="font-size:14px;color:#64748b;margin-top:4px;">Weekly Performance Digest</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${dateStr}</div>
    </td></tr>

    ${accountSections.join("")}

    <tr><td style="padding:32px 0 16px 0;text-align:center;">
      <a href="${siteUrl}" style="display:inline-block;padding:10px 28px;background:#1a2e1a;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
        View full dashboard →
      </a>
    </td></tr>

    <tr><td style="text-align:center;padding-top:24px;border-top:1px solid #e2e8f0;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">
        You're receiving this because you have digest emails enabled.
        <br />To unsubscribe, go to User Settings → Email Digest and toggle it off.
      </p>
    </td></tr>
  </table>
</body>
</html>`;

    const body = await req.json().catch(() => ({}));
    const previewOnly = body.preview === true;

    if (previewOnly) {
      return new Response(JSON.stringify({ html, subject: `Goodo Studios Weekly Performance — ${dateStr}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to send via Resend if key is configured
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Verdanote <digest@verdanote.com>",
          to: [profile.email],
          subject: `Goodo Studios Weekly Performance — ${dateStr}`,
          html,
        }),
      });
      const sendResult = await sendRes.json();
      if (!sendRes.ok) {
        console.error("Resend error:", sendResult);
        return new Response(
          JSON.stringify({ error: "Failed to send email", details: sendResult }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update last_digest_sent_at
      await admin
        .from("user_preferences")
        .update({ last_digest_sent_at: new Date().toISOString() } as any)
        .eq("user_id", userId);

      return new Response(
        JSON.stringify({ success: true, emailId: sendResult.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // No Resend key — log and return HTML
    console.log("No RESEND_API_KEY configured. Digest HTML generated but not sent.");

    // Still update last_digest_sent_at
    await admin
      .from("user_preferences")
      .update({ last_digest_sent_at: new Date().toISOString() } as any)
      .eq("user_id", userId);

    return new Response(
      JSON.stringify({
        success: true,
        html,
        note: "No RESEND_API_KEY configured — email not sent. HTML returned for preview.",
        subject: `Goodo Studios Weekly Performance — ${dateStr}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("send-digest error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
