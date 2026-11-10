// Queries the restructured staff shell sends from the browser, kept in one place so the staging
// wall check (scripts/staging-client-wall-check.mjs) can run the same select strings against the
// real staging database. src/test/pageQueryCheck.test.ts fails if this list and the script drift.
//
// PostgREST refuses a select that names a column or relationship that does not exist, which
// leaves a page empty while every mocked unit test still passes. The wall check is the live check.

export interface PageQuery {
  table: string;
  select: string;
  /** Where the query is sent from. */
  usedBy: string;
  /** Column the page filters on (equals one client slug). The wall check runs it for a real client. */
  filter?: string;
}

export const CLIENT_SWITCHER_COLUMNS = "slug, name, active";
export const CLIENT_SWITCHER_LINK_COLUMNS = "account_id, client_slug";
export const PIPELINE_TASK_COLUMNS = "id, task_name, stage, due_date, content_type, updated_at";

export const PAGE_QUERIES: PageQuery[] = [
  { table: "clients", select: CLIENT_SWITCHER_COLUMNS, usedBy: "client switcher (ClientSelectionContext)" },
  { table: "client_ad_accounts", select: CLIENT_SWITCHER_LINK_COLUMNS, usedBy: "client switcher (ClientSelectionContext)" },
  { table: "pipeline_tasks", select: PIPELINE_TASK_COLUMNS, usedBy: "client hub Work tab (useClientWork)", filter: "client_slug" },
];
