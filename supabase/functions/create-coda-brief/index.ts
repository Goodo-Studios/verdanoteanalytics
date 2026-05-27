// ═══════════════════════════════════════════════════════════════════════════
// create-coda-brief — merged with Creative Vault's vault-coda-brief (US-012)
// ═══════════════════════════════════════════════════════════════════════════
//
// Merge audit (vault-coda-brief → create-coda-brief):
//   • Both functions write to the SAME Coda doc/table (Edw6ZW63pk /
//     grid-MEOygYxxim) and the SAME columns (Task, Connected Project, Brief,
//     Stage). The Coda contract is identical.
//   • vault-coda-brief took { items[], project_name } and built a markdown
//     brief from a list of saved ads (title, creator, platform, stats,
//     description). It was a "viral feed roundup" brief.
//   • create-coda-brief took { creative_id, account_id, account_name,
//     task_name, brief_note, user_id } and pushed a single Verdanote creative
//     to Coda with a free-form brief_note. The enrichment from `creatives`
//     was computed but never embedded in the body.
//
// Merge strategy (US-012):
//   • Single discriminated input via `source: 'vault' | 'creative'`. When
//     omitted, defaults to 'creative' so EVERY existing caller continues to
//     work unchanged (CreativeDetailModal.handlePushToCoda).
//   • When `source === 'vault'`, the function pulls the inspiration_items
//     row plus inspiration_transcripts + inspiration_frameworks for the
//     given inspiration_item_id, then injects transcript + framework +
//     script_analysis / visual_analysis into the brief markdown.
//   • Multi-item vault payloads (the old vault-coda-brief items[] shape) are
//     also supported by accepting `inspiration_item_ids: string[]` or the
//     legacy `items[]` array of pre-shaped BriefItem objects.
//   • vault-coda-brief is NOT deployed as a separate function. Verdanote's
//     supabase/config.toml has a single [functions.create-coda-brief] entry
//     and no vault-coda-brief entry.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const CODA_DOC_ID = "Edw6ZW63pk";
const CODA_TABLE_ID = "grid-MEOygYxxim";
const CODA_API_BASE = "https://coda.io/apis/v1";

// ── Types ──────────────────────────────────────────────────────────────────

type VaultBriefItem = {
  title: string | null;
  source_url: string;
  platform: string;
  creator_handle: string | null;
  view_count: number | null;
  like_count: number | null;
  share_count: number | null;
  category: string | null;
  description: string | null;
};

type InspirationRow = {
  id: string;
  title: string | null;
  source_url: string | null;
  platform: string | null;
  creator_handle: string | null;
  brand_name: string | null;
  industry: string | null;
  ad_format: string | null;
  target_audience: string | null;
  script_analysis: string | null;
  visual_analysis: string | null;
  inspiration_transcripts: Array<{ cleaned_script: string | null; raw_transcript: string | null }> | null;
  inspiration_frameworks: Array<{
    hook_type: string | null;
    hook_formula: string | null;
    value_structure: string | null;
    cta_type: string | null;
    cta_formula: string | null;
    fill_in_blank_script: string | null;
    copywriting_framework: string | null;
    hook_verbal: string | null;
    hook_text: string | null;
  }> | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function buildVaultItemsBrief(items: VaultBriefItem[], projectName: string): string {
  const lines: string[] = [
    `# Viral Feed Brief`,
    `**Project:** ${projectName}`,
    `**Generated:** ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    `**Items:** ${items.length}`,
    "",
    "---",
    "",
  ];

  items.forEach((item, i) => {
    lines.push(`## ${i + 1}. ${item.title ?? item.source_url}`);
    if (item.creator_handle) lines.push(`**Creator:** @${item.creator_handle}`);
    if (item.platform) {
      lines.push(`**Platform:** ${item.platform.charAt(0).toUpperCase() + item.platform.slice(1)}`);
    }
    if (item.category) lines.push(`**Category:** ${item.category}`);
    lines.push(
      `**Stats:** ${formatCount(item.view_count)} views · ${formatCount(item.like_count)} likes · ${formatCount(item.share_count)} shares`,
    );
    if (item.source_url) lines.push(`**Link:** ${item.source_url}`);
    if (item.description) {
      lines.push(
        `**Description:** ${item.description.slice(0, 300)}${item.description.length > 300 ? "…" : ""}`,
      );
    }
    lines.push("");
  });

  return lines.join("\n");
}

function buildInspirationBrief(
  row: InspirationRow,
  briefNote: string,
): string {
  const transcript = row.inspiration_transcripts?.[0] ?? null;
  const framework = row.inspiration_frameworks?.[0] ?? null;
  const cleanedScript = transcript?.cleaned_script ?? transcript?.raw_transcript ?? null;

  const lines: string[] = [];

  if (briefNote && briefNote.trim().length > 0) {
    lines.push(briefNote.trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push(`# Vault Item Brief`);
  if (row.title) lines.push(`**Title:** ${row.title}`);
  if (row.brand_name) lines.push(`**Brand:** ${row.brand_name}`);
  if (row.creator_handle) lines.push(`**Creator:** @${row.creator_handle}`);
  if (row.platform) {
    lines.push(`**Platform:** ${row.platform.charAt(0).toUpperCase() + row.platform.slice(1)}`);
  }
  if (row.industry) lines.push(`**Industry:** ${row.industry}`);
  if (row.ad_format) lines.push(`**Ad format:** ${row.ad_format}`);
  if (row.target_audience) lines.push(`**Target audience:** ${row.target_audience}`);
  if (row.source_url) lines.push(`**Source:** ${row.source_url}`);
  lines.push("");

  if (cleanedScript) {
    lines.push(`## Transcript`);
    lines.push(cleanedScript);
    lines.push("");
  }

  if (framework) {
    lines.push(`## Framework`);
    if (framework.hook_type) lines.push(`- **Hook type:** ${framework.hook_type}`);
    if (framework.hook_formula) lines.push(`- **Hook formula:** ${framework.hook_formula}`);
    if (framework.hook_verbal) lines.push(`- **Hook (verbal):** ${framework.hook_verbal}`);
    if (framework.hook_text) lines.push(`- **Hook (text):** ${framework.hook_text}`);
    if (framework.value_structure) lines.push(`- **Value structure:** ${framework.value_structure}`);
    if (framework.cta_type) lines.push(`- **CTA type:** ${framework.cta_type}`);
    if (framework.cta_formula) lines.push(`- **CTA formula:** ${framework.cta_formula}`);
    if (framework.copywriting_framework) {
      lines.push(`- **Copywriting framework:** ${framework.copywriting_framework}`);
    }
    if (framework.fill_in_blank_script) {
      lines.push("");
      lines.push(`### Fill-in-blank script`);
      lines.push(framework.fill_in_blank_script);
    }
    lines.push("");
  }

  if (row.script_analysis) {
    lines.push(`## Script analysis`);
    lines.push(row.script_analysis);
    lines.push("");
  }
  if (row.visual_analysis) {
    lines.push(`## Visual analysis`);
    lines.push(row.visual_analysis);
    lines.push("");
  }

  return lines.join("\n");
}

async function pushRowToCoda(
  apiKey: string,
  taskName: string,
  projectName: string,
  brief: string,
): Promise<{ ok: true; rowId: string | null } | { ok: false; status: number; body: string }> {
  const res = await fetch(
    `${CODA_API_BASE}/docs/${CODA_DOC_ID}/tables/${CODA_TABLE_ID}/rows`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rows: [
          {
            cells: [
              { column: "Task", value: taskName },
              { column: "Connected Project", value: projectName },
              { column: "Brief", value: brief },
              { column: "Stage", value: "Brief Creation" },
            ],
          },
        ],
      }),
    },
  );

  const bodyText = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: bodyText };
  }

  let rowId: string | null = null;
  try {
    const parsed = JSON.parse(bodyText);
    rowId = parsed?.addedRowIds?.[0] ?? null;
  } catch {
    // tolerate non-JSON success responses
  }
  return { ok: true, rowId };
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const CODA_API_KEY = Deno.env.get("CODA_API_KEY");
    if (!CODA_API_KEY) {
      throw new Error("CODA_API_KEY is not configured");
    }

    const body = await req.json();

    // Discriminate the input shape. Accept both the legacy create-coda-brief
    // shape (default — `source` absent) and the vault-coda-brief shape.
    const source: "vault" | "creative" =
      body.source === "vault" ||
      body.inspiration_item_id ||
      Array.isArray(body.inspiration_item_ids) ||
      Array.isArray(body.items)
        ? "vault"
        : "creative";

    // ── Vault path ─────────────────────────────────────────────────────────
    if (source === "vault") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      // Three accepted vault payload shapes:
      //   1. { inspiration_item_id: "<uuid>", task_name?, brief_note?,
      //        account_name? }
      //   2. { inspiration_item_ids: ["<uuid>", ...], project_name?,
      //        task_name? }
      //   3. { items: BriefItem[], project_name?, task_name? } — legacy
      //      vault-coda-brief shape, pre-shaped on the caller side.

      const projectName: string =
        body.project_name ?? body.account_name ?? "Viral Feed";
      const briefNote: string = body.brief_note ?? "";

      let brief: string;
      let defaultTaskName: string;

      if (body.inspiration_item_id) {
        const { data: row, error } = await supabase
          .from("inspiration_items")
          .select(
            `id, title, source_url, platform, creator_handle, brand_name,
             industry, ad_format, target_audience, script_analysis,
             visual_analysis,
             inspiration_transcripts(cleaned_script, raw_transcript),
             inspiration_frameworks(hook_type, hook_formula, value_structure,
               cta_type, cta_formula, fill_in_blank_script, copywriting_framework,
               hook_verbal, hook_text)`,
          )
          .eq("id", body.inspiration_item_id)
          .single<InspirationRow>();

        if (error || !row) {
          return json(
            { error: `inspiration_item ${body.inspiration_item_id} not found` },
            404,
          );
        }
        brief = buildInspirationBrief(row, briefNote);
        defaultTaskName = `Vault Brief — ${row.brand_name ?? row.title ?? row.id}`;
      } else if (Array.isArray(body.inspiration_item_ids) && body.inspiration_item_ids.length > 0) {
        const { data: rows, error } = await supabase
          .from("inspiration_items")
          .select(
            `id, title, source_url, platform, creator_handle, brand_name,
             industry, ad_format, target_audience, script_analysis,
             visual_analysis,
             inspiration_transcripts(cleaned_script, raw_transcript),
             inspiration_frameworks(hook_type, hook_formula, value_structure,
               cta_type, cta_formula, fill_in_blank_script, copywriting_framework,
               hook_verbal, hook_text)`,
          )
          .in("id", body.inspiration_item_ids);

        if (error) {
          return json({ error: error.message }, 500);
        }
        if (!rows || rows.length === 0) {
          return json({ error: "No matching inspiration_items" }, 404);
        }

        // Combine each item's enriched brief under one document.
        const sections = (rows as InspirationRow[]).map((r, i) => {
          const inner = buildInspirationBrief(r, "");
          return `## Item ${i + 1}\n\n${inner}`;
        });
        const header = [
          `# Vault Brief`,
          `**Project:** ${projectName}`,
          `**Generated:** ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
          `**Items:** ${rows.length}`,
          "",
          "---",
          "",
        ];
        const noteBlock = briefNote.trim().length > 0 ? [briefNote.trim(), "", "---", ""] : [];
        brief = [...header, ...noteBlock, ...sections].join("\n");
        defaultTaskName = `Vault Brief — ${projectName} (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
      } else {
        // Legacy vault-coda-brief shape: { items: BriefItem[], project_name }.
        const items: VaultBriefItem[] = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) {
          return json({ error: "No items provided" }, 400);
        }
        brief = buildVaultItemsBrief(items, projectName);
        defaultTaskName = `Viral Brief — ${projectName} (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
      }

      const taskName: string =
        (typeof body.task_name === "string" && body.task_name.trim().length > 0)
          ? body.task_name
          : defaultTaskName;

      const result = await pushRowToCoda(CODA_API_KEY, taskName, projectName, brief);
      if (!result.ok) {
        console.error("Coda API error:", result.status, result.body);
        return json({ error: `Coda API error: ${result.status}` }, 502);
      }
      console.log(`Sent vault brief "${taskName}" to Coda`);
      return json({ ok: true, success: true, rowId: result.rowId });
    }

    // ── Creative path (existing Verdanote callers) ─────────────────────────
    const { creative_id, account_id, account_name, task_name, brief_note } = body as {
      creative_id?: string;
      account_id?: string;
      account_name?: string;
      task_name?: string;
      brief_note?: string;
      user_id?: string;
    };

    if (!account_id || !account_name) {
      return new Response(
        JSON.stringify({ error: "account_id and account_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Optionally enrich with creative data — preserved for parity with the
    // pre-merge create-coda-brief; the enrichment is fetched (and could be
    // surfaced later) but is not embedded in the existing brief contract so
    // existing callers see no behaviour change.
    if (creative_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await supabase
        .from("creatives")
        .select("ad_name, roas, spend, ad_type, hook, theme, style")
        .eq("ad_id", creative_id)
        .single();
    }

    const codaRes = await fetch(
      `${CODA_API_BASE}/docs/${CODA_DOC_ID}/tables/${CODA_TABLE_ID}/rows`,
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
                { column: "Stage", value: "Brief Creation" },
              ],
            },
          ],
        }),
      },
    );

    const codaBody = await codaRes.text();
    if (!codaRes.ok) {
      throw new Error(`Coda API error [${codaRes.status}]: ${codaBody}`);
    }

    return new Response(
      JSON.stringify({ success: true, coda: JSON.parse(codaBody) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    console.error("create-coda-brief error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
