/**
 * Which reports the staff Reports page lists for the selected account.
 *
 * A portfolio report has no owning account (account_id is null, audit 1.3), so it is listed
 * under every account in its portfolio_account_ids, and under "all".
 */
export interface ReportListRow {
  account_id?: string | null;
  report_type?: string | null;
  portfolio_account_ids?: string[] | null;
}

export function reportsForAccount<T extends ReportListRow>(reports: T[], selectedAccountId: string | null | undefined): T[] {
  if (!selectedAccountId || selectedAccountId === "all") return reports;
  return reports.filter((r) =>
    r.account_id === selectedAccountId ||
    (r.report_type === "portfolio" && (r.portfolio_account_ids ?? []).includes(selectedAccountId)),
  );
}
