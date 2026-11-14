// The staff page kit. Staff pages build from these pieces so they look and behave alike:
// PageShell + PageHeader on top, FilterBar under it, then LoadingState / ErrorState /
// EmptyState / DataTable for the body, StatusBadge for statuses, Fields for forms and
// useConfirm / ConfirmTrigger in place of window.confirm. Dates and numbers come from
// "@/lib/formatters" (re-exported here so there is one entry point).
export { PageShell } from "./PageShell";
export { PageHeader } from "@/components/PageHeader";
export { FilterBar } from "./FilterBar";
export { DataTable, type DataColumn, KIT_STICKY_HEADER, KIT_ROW_LINES, KIT_HEAD_CELL, KIT_NUM_CELL } from "./DataTable";
export { MetricCard, MetricGrid, type MetricChange } from "./MetricCard";
export { StatusBadge } from "./StatusBadge";
export { statusKeyOf, type StatusKey } from "./statusMap";
export { EmptyState } from "./EmptyState";
export { LoadingState } from "./LoadingState";
export { ErrorState } from "./ErrorState";
export { ConfirmDialog, type ConfirmCopy } from "./ConfirmAction";
export { ConfirmTrigger } from "./ConfirmTrigger";
export { useConfirm } from "./useConfirm";
export { TextField, TextareaField, SelectField, NATIVE_SELECT_CLASS, type SelectOption } from "./Fields";
export { fmt$, fmtN, fmtPct, fmtMetric, fmtDate, fmtDateTime, fmtTimeAgo, fmtWhen } from "@/lib/formatters";
