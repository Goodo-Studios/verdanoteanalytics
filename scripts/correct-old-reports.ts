// Correct reports made before the report math fix (#314), in place (audit plan item 6.3).
//
// Each report is rebuilt for its own account and dates with the same code a new report uses
// (supabase/functions/_shared/standard-report.ts). The original row is saved to
// report_corrections first. Reports with no daily data left are skipped.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run -A scripts/correct-old-reports.ts --ids ids.txt [--apply]
//
// Without --apply it is a dry run: it computes the new numbers and prints them next to the old
// ones, and writes nothing. ids.txt holds one report id per line.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStandardReportFields, correctReport } from "../supabase/functions/_shared/standard-report.ts";

const args = Deno.args;
const idsPath = args[args.indexOf("--ids") + 1];
const apply = args.includes("--apply");
if (!args.includes("--ids") || !idsPath) {
  console.error("usage: deno run -A scripts/correct-old-reports.ts --ids ids.txt [--apply]");
  Deno.exit(2);
}

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  Deno.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const ids = (await Deno.readTextFile(idsPath)).split(/\s+/).filter(Boolean);
const counts: Record<string, number> = {};
const out: unknown[] = [];

for (const id of ids) {
  const { data: row, error } = await supabase.from("reports").select("*").eq("id", id).maybeSingle();
  if (error || !row) {
    counts.missing = (counts.missing ?? 0) + 1;
    out.push({ id, status: "missing", error: error?.message ?? null });
    continue;
  }
  if (apply) {
    const r = await correctReport(supabase, row);
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    out.push(r);
  } else {
    const f = await buildStandardReportFields(
      supabase, row.account_id ?? null, row.date_range_start, row.date_range_end, row.date_range_days,
    );
    const status = f.creative_count ? "would_correct" : "no_data";
    counts[status] = (counts[status] ?? 0) + 1;
    out.push({
      id, status,
      before: { total_spend: row.total_spend, blended_roas: row.blended_roas, average_cpa: row.average_cpa, average_ctr: row.average_ctr },
      after: { total_spend: f.total_spend, blended_roas: f.blended_roas, average_cpa: f.average_cpa, average_ctr: f.average_ctr },
    });
  }
}

console.log(JSON.stringify({ apply, counts, results: out }, null, 2));
