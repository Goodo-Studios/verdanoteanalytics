// Pure helpers for scripts/staff-reconciliation-report.mjs (step 5d). No network, no secrets.
//
// The report prints counts only: how many people the reconciliation covers and how many have
// each issue. It never prints a name or an email, so its output can go in a build log.

export const ISSUE_ORDER = [
  "no_login",
  "client_login",
  "no_staff_role",
  "role_differs",
  "mapping_needs_owner",
  "inactive_with_staff_role",
  "not_on_team_list",
  "possible_name_match",
];

/** Counts people and issues from staff_reconciliation() rows. Unknown issue names are kept. */
export function countIssues(rows) {
  const counts = Object.fromEntries(ISSUE_ORDER.map((k) => [k, 0]));
  let people = 0;
  let clean = 0;
  for (const row of rows ?? []) {
    people++;
    const issues = Array.isArray(row?.issues) ? row.issues : [];
    if (issues.length === 0) clean++;
    for (const issue of issues) counts[issue] = (counts[issue] ?? 0) + 1;
  }
  return { people, clean, withIssues: people - clean, counts };
}

/** One line per figure, in a fixed order, with no personal data. */
export function formatReport({ people, clean, withIssues, counts }) {
  const lines = [`people ${people}`, `lined up ${clean}`, `with at least one issue ${withIssues}`];
  const keys = [...ISSUE_ORDER, ...Object.keys(counts).filter((k) => !ISSUE_ORDER.includes(k)).sort()];
  for (const k of keys) lines.push(`${k} ${counts[k] ?? 0}`);
  return lines.join("\n");
}

/** The report runs against staging only. */
export function assertNotProduction(url) {
  if (!url) throw new Error("Set STAGING_SUPABASE_URL.");
  if (url.includes("gwyxaqoaldnaavkjqquv")) throw new Error("Refusing to run: that URL is the production project.");
}
