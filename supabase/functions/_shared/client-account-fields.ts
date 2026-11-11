// The ad_accounts columns a client login may read, and nothing else.
//
// Row rules limit which accounts a client sees, not which columns. The accounts
// function reads with the service-role key, so for a client it must name these
// columns itself. Everything not listed here is staff only: AI prompts, kill and
// scale thresholds, client responsiveness, attribution notes, targets, sync
// settings, portfolio settings and the TikTok access token.
//
// Each field is here because a page a client can open reads it:
//   id, name             account switcher, page titles (AppSidebar, Overview, Compare)
//   created_at           list order
//   last_synced_at       "Synced 3 hours ago" on the Overview page
//   optimization_goal    the result column on the Creatives page
//   winner_kpi, winner_kpi_direction, winner_kpi_threshold, winner_roas_threshold,
//   iteration_spend_threshold
//                        win rate, Tag Insights, Iterations and Creative DNA tabs on
//                        the Analytics page
//
// scripts/staging-client-wall-functions.mjs keeps a copy of this list for the
// staging field check. Change both together.

export const CLIENT_ACCOUNT_FIELDS = [
  "id",
  "name",
  "created_at",
  "last_synced_at",
  "optimization_goal",
  "winner_kpi",
  "winner_kpi_direction",
  "winner_kpi_threshold",
  "winner_roas_threshold",
  "iteration_spend_threshold",
] as const;

export type ClientAccountField = typeof CLIENT_ACCOUNT_FIELDS[number];
export type ClientAccount = Partial<Record<ClientAccountField, unknown>>;

/** Column list for `.select()` on the client path. */
export const CLIENT_ACCOUNT_SELECT = CLIENT_ACCOUNT_FIELDS.join(", ");

/**
 * Columns that must never reach a client. Used by tests and the staging wall check
 * as a second guard: if one of these ever shows up in a client response the check
 * fails even if someone adds it to the allow-list above by mistake.
 */
export const STAFF_ONLY_ACCOUNT_FIELDS = [
  "client_responsiveness",
  "client_start_date",
  "attribution_notes",
  "attribution_model",
  "creative_analysis_prompt",
  "insights_prompt",
  "company_description",
  "company_pdf_url",
  "kill_threshold",
  "scale_threshold",
  "kill_scale_kpi",
  "kill_scale_kpi_direction",
  "tiktok_access_token",
  "tiktok_advertiser_id",
  "target_roas",
  "target_cpa",
  "target_monthly_spend",
  "primary_kpi",
  "secondary_kpis",
  "industry_category",
] as const;

/** Copy only the allow-listed fields of one row. A second guard after the select. */
export function toClientAccount(row: Record<string, unknown>): ClientAccount {
  const out: ClientAccount = {};
  for (const field of CLIENT_ACCOUNT_FIELDS) {
    if (field in row) out[field] = row[field];
  }
  return out;
}
