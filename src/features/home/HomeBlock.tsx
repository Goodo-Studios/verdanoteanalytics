// One block of the staff Home page: a title, at most five one-line rows, and a "See all" link.
// Loading, error and empty are three different things on screen. Red is used only on late rows.
import { Link } from "react-router-dom";
import { BLOCK_ROWS } from "@/lib/homeData";

export interface BlockRow {
  key: string;
  primary: string;
  secondary?: string;
  /** Role-relative address; the block adds the role prefix. */
  to: string;
  /** Right-hand text, such as a due date. */
  right?: string;
  /** Late: the only reason a row is red. */
  late?: boolean;
}

export type BlockStatus = "loading" | "error" | "ready";

interface Props {
  id: string;
  title: string;
  status: BlockStatus;
  rows: BlockRow[];
  emptyText: string;
  seeAllTo: string;
  prefix: string;
  onRetry?: () => void;
}

export function HomeBlock({ id, title, status, rows, emptyText, seeAllTo, prefix, onRetry }: Props) {
  const shown = rows.slice(0, BLOCK_ROWS);
  return (
    <section aria-labelledby={`home-block-${id}-title`} className="space-y-2" data-testid={`home-block-${id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`home-block-${id}-title`} className="text-sm font-semibold text-forest">
          {title}
          {status === "ready" && rows.length > 0 ? <span className="ml-2 font-normal text-muted-foreground">{rows.length}</span> : null}
        </h2>
        <Link to={`${prefix}${seeAllTo}`} className="text-xs text-muted-foreground underline" data-testid={`home-block-${id}-see-all`}>
          See all
        </Link>
      </div>
      {status === "loading" ? (
        <p role="status" className="rounded-lg border border-input px-4 py-3 text-sm text-muted-foreground" data-testid={`home-block-${id}-loading`}>
          Loading...
        </p>
      ) : status === "error" ? (
        <div role="alert" className="rounded-lg border border-destructive/40 px-4 py-3 text-sm" data-testid={`home-block-${id}-error`}>
          We could not load this, so the list is not the same as being empty.
          {onRetry ? (
            <>
              {" "}
              <button type="button" className="underline" onClick={onRetry}>Try again</button>
            </>
          ) : null}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground" data-testid={`home-block-${id}-empty`}>
          {emptyText}
        </p>
      ) : (
        <ul className="divide-y divide-input rounded-lg border border-input">
          {shown.map((r) => (
            <li key={r.key}>
              <Link
                to={`${prefix}${r.to}`}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
                data-testid={`home-block-${id}-row`}
                data-late={r.late ? "true" : undefined}
              >
                <span className="min-w-0 truncate">
                  <span className={r.late ? "font-medium text-red-700" : "font-medium"}>{r.primary}</span>
                  {r.secondary ? <span className="text-muted-foreground"> {r.secondary}</span> : null}
                </span>
                {r.right ? <span className={`shrink-0 text-xs ${r.late ? "text-red-700" : "text-muted-foreground"}`}>{r.right}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
