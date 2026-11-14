// OS-023: the four export statuses a task checklist can stand in for. The statuses stay in
// os_task_statuses; the checklist only replaces them when the os_settings switch is on.

export const EXPORT_CHECKLIST_SETTING = "export_checklist_replaces_statuses";

export const EXPORT_STATUSES: readonly string[] = [
  "export versions",
  "versions exported",
  "ready to send to client",
  "ready to transfer",
];

/** The label shown for a status in place of the four export statuses when the switch is on. */
export const EXPORTING_LABEL = "exporting";

export function isExportStatus(status: string | null | undefined): boolean {
  return EXPORT_STATUSES.includes((status ?? "").trim().toLowerCase());
}

/** The status as shown to staff: unchanged when the switch is off. */
export function displayStatus(status: string, checklistOn: boolean): string {
  return checklistOn && isExportStatus(status) ? EXPORTING_LABEL : status;
}
