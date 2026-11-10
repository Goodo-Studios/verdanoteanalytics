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
  /** Home and Work: staff read the whole table (it may be empty), a client login reads none of it. Not run for a client. */
  staffList?: boolean;
}

export const CLIENT_SWITCHER_COLUMNS = "slug, name, active";
export const CLIENT_SWITCHER_LINK_COLUMNS = "account_id, client_slug";
export const PIPELINE_TASK_COLUMNS = "id, task_name, stage, due_date, content_type, updated_at";
// The client's own board by cycle (phase 5). A client login sends these with no filter: the row rules decide.
export const CLIENT_BOARD_COLUMNS = "id, task_name, stage, due_date, content_type, updated_at, cycle_month, delivered_at";
export const CLIENT_DELIVERED_COLUMNS = "id, task_name, content_type, cycle_month, delivered_at, updated_at";
export const CLIENT_ENGAGEMENT_COLUMNS = "start_date, day45_date, status";
export const CLIENT_LINK_COLUMNS = "client_slug";
// Staff Home and the cross-client Work page (restructure phase 2b).
export const HOME_TASK_COLUMNS = "id, clickup_task_id, client_slug, task_name, stage, due_date, synced_at";
export const HOME_HANDOFF_COLUMNS = "id, client_slug, receiving_role, receiver_id, due_date, status";
export const HOME_SUPPORT_COLUMNS = "id, client_slug, subject, status, next_update_target, accountable_user_id, backup_user_id";
export const HOME_BUDGET_ALERT_COLUMNS = "id, level, period_month";
export const CHECK_RUN_COLUMNS = "check_key, trigger, outcome, created_at";
export const SETUP_AD_ACCOUNT_COLUMNS = "id, name";
export const SETUP_MAPPING_COLUMNS = "id, client_slug, provider, kind, external_id, label, active";
// Admin, Notifications (phase 4 PR 4). Kept equal to the column lists in features/notifications/model.ts.
export const NOTIFY_DESTINATION_COLUMNS = "id, label, channel_id, purpose, client_slug, owner_confirmed, active";
export const NOTIFY_SWITCH_COLUMNS = "name, enabled, note, updated_at";
export const NOTIFY_REMINDER_COLUMNS = "id, kind, body, due_at, state, destination_id, client_slug, for_member_id, created_by, created_at";
export const NOTIFY_TEAM_COLUMNS = "id, name, email, role, active";

export const PAGE_QUERIES: PageQuery[] = [
  { table: "clients", select: CLIENT_SWITCHER_COLUMNS, usedBy: "client switcher (ClientSelectionContext)" },
  { table: "client_ad_accounts", select: CLIENT_SWITCHER_LINK_COLUMNS, usedBy: "client switcher (ClientSelectionContext)" },
  { table: "pipeline_tasks", select: PIPELINE_TASK_COLUMNS, usedBy: "client hub Work tab (useClientWork)", filter: "client_slug" },
  { table: "pipeline_tasks", select: CLIENT_BOARD_COLUMNS, usedBy: "client board by cycle (usePipelineTasks)", filter: "client_slug" },
  { table: "pipeline_delivered", select: CLIENT_DELIVERED_COLUMNS, usedBy: "client past cycles (usePipelineDelivered)", filter: "client_slug" },
  { table: "engagements", select: CLIENT_ENGAGEMENT_COLUMNS, usedBy: "client cycle dates (useCycleEngagements)", filter: "client_slug" },
  { table: "client_members", select: CLIENT_LINK_COLUMNS, usedBy: "client landing page (useOwnClientLinks)", filter: "client_slug" },
  { table: "pipeline_tasks", select: HOME_TASK_COLUMNS, usedBy: "staff Home and Work page (useHomeData)", staffList: true },
  { table: "handoff_packets", select: HOME_HANDOFF_COLUMNS, usedBy: "staff Home, My handoffs (useHomeData)", staffList: true },
  { table: "support_requests", select: HOME_SUPPORT_COLUMNS, usedBy: "staff Home, My support requests and Clients needing attention (useHomeData)", staffList: true },
  { table: "operating_budget_alerts", select: HOME_BUDGET_ALERT_COLUMNS, usedBy: "builder Home, Clients needing attention (useHomeData)", staffList: true },
  // filter is the check name here: the wall check runs it with a value that matches no run, to prove the select is valid.
  { table: "check_runs", select: CHECK_RUN_COLUMNS, usedBy: "Operating costs and Integration health, last run (LastRunLine)", filter: "check_key" },
  { table: "ad_accounts", select: SETUP_AD_ACCOUNT_COLUMNS, usedBy: "client hub Setup tab (ClientSetupTab)" },
  { table: "source_mappings", select: SETUP_MAPPING_COLUMNS, usedBy: "client hub Setup tab (ClientSetupTab)", filter: "client_slug" },
  { table: "slack_destinations", select: NOTIFY_DESTINATION_COLUMNS, usedBy: "Admin Notifications page", filter: "purpose" },
  { table: "outbound_switches", select: NOTIFY_SWITCH_COLUMNS, usedBy: "Admin Notifications page", filter: "name" },
  { table: "reminders", select: NOTIFY_REMINDER_COLUMNS, usedBy: "Admin Notifications page", filter: "state" },
  { table: "app_users", select: NOTIFY_TEAM_COLUMNS, usedBy: "Admin Notifications page, who a reminder is for", filter: "role" },
];
