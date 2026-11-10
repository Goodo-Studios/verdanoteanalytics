import { useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead, type SortConfig } from "@/components/SortableTableHead";
import { cn } from "@/lib/utils";

export interface DataColumn<T> {
  key: string;
  /** Column title. Pass an empty string and `srOnlyHeader` for an actions column. */
  header: string;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable. Return the value to compare, `null` sorts last. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  className?: string;
  /** Hide the title visually but keep it for screen readers. */
  srOnlyHeader?: boolean;
}

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** The accessible name of the table. */
  label: string;
  onRowClick?: (row: T) => void;
  rowTestId?: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  /** Shown in one full-width row when there are no rows. */
  empty?: ReactNode;
  stickyHeader?: boolean;
  /** Start sorted by this column. */
  defaultSort?: SortConfig;
  /** Minimum width before the table scrolls sideways, as a Tailwind class. */
  minWidthClass?: string;
  className?: string;
}

const INTERACTIVE = "a,button,input,select,textarea,label,[role=button],[role=checkbox]";

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const aNone = a === null || a === undefined || a === "";
  const bNone = b === null || b === undefined || b === "";
  if (aNone && bNone) return 0;
  if (aNone) return 1;
  if (bNone) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/**
 * The one table for staff pages. It wraps `ui/table`, scrolls sideways on small screens
 * instead of squashing, can sort, can make rows clickable, and shows an empty row.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  onRowClick,
  rowTestId,
  rowClassName,
  empty = "Nothing to show yet.",
  stickyHeader = false,
  defaultSort,
  minWidthClass = "min-w-[40rem]",
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortConfig>(defaultSort ?? { key: "", direction: null });

  const shown = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue || !sort.direction) return rows;
    const get = col.sortValue;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const ca = get(a);
      const cb = get(b);
      // Empty values stay last in both directions.
      const aNone = ca === null || ca === undefined || ca === "";
      const bNone = cb === null || cb === undefined || cb === "";
      if (aNone || bNone) return compare(ca, cb);
      return dir * compare(ca, cb);
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s.key !== key ? { key, direction: "asc" } : s.direction === "asc" ? { key, direction: "desc" } : { key: "", direction: null }));

  const clickable = (row: T) =>
    onRowClick
      ? {
          tabIndex: 0,
          className: "cursor-pointer",
          onClick: (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
            onRowClick(row);
          },
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row);
          },
        }
      : {};

  return (
    <div data-testid="data-table" className={cn(stickyHeader && "[&>div]:max-h-[70vh]", className)}>
      <Table aria-label={label} className={minWidthClass}>
        <TableHeader className={cn(stickyHeader && "[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted")}>
          <TableRow>
            {columns.map((c) =>
              c.sortValue ? (
                <SortableTableHead
                  key={c.key}
                  label={c.header}
                  sortKey={c.key}
                  currentSort={sort}
                  onSort={toggle}
                  className={c.align === "right" ? "text-right" : undefined}
                />
              ) : (
                <TableHead
                  key={c.key}
                  className={cn("font-label text-[11px] font-semibold uppercase tracking-[0.04em] text-slate", c.align === "right" && "text-right")}
                >
                  {c.srOnlyHeader ? <span className="sr-only">{c.header}</span> : c.header}
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            shown.map((row) => {
              const extra = clickable(row);
              return (
                <TableRow
                  key={rowKey(row)}
                  data-testid={rowTestId?.(row)}
                  {...extra}
                  className={cn(extra.className, rowClassName?.(row))}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn("align-top text-sm", c.align === "right" && "text-right", c.className)}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
