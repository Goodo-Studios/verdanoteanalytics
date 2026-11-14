// One block of the staff Home page: a title, at most five one-line rows, and a "See all" link.
// Loading, error and empty are three different things on screen. Red is used only on late rows.
import { Link } from "react-router-dom";
import { BLOCK_ROWS } from "@/lib/homeData";
import { ViewAssetLink } from "@/components/client/ViewAssetLink";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-kit";

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
  /** Air review link; shown as a small "View asset" link beside the row, not inside it. */
  assetLink?: string | null;
  /** A new item staff have not seen yet (a client decision in the last 48 hours). */
  isNew?: boolean;
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
        <div data-testid={`home-block-${id}-loading`}>
          <LoadingState label={`Loading ${title}`} count={2} />
        </div>
      ) : status === "error" ? (
        <div data-testid={`home-block-${id}-error`}>
          <ErrorState message="We could not load this, so the list is not the same as being empty." onRetry={onRetry} />
        </div>
      ) : shown.length === 0 ? (
        <div data-testid={`home-block-${id}-empty`}>
          <EmptyState title={emptyText} className="py-4" />
        </div>
      ) : (
        <ul className="divide-y divide-input rounded-lg border border-input">
          {shown.map((r) => (
            <li key={r.key} className="flex items-center gap-2 pr-3">
              <Link
                to={`${prefix}${r.to}`}
                className="flex min-w-0 flex-1 items-baseline justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
                data-testid={`home-block-${id}-row`}
                data-late={r.late ? "true" : undefined}
                data-new={r.isNew ? "true" : undefined}
              >
                {r.isNew ? <span className="mr-2 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900" data-testid="home-row-new">New</span> : null}
                <span className="min-w-0 truncate">
                  <span className={r.late ? "font-medium text-red-700" : "font-medium"}>{r.primary}</span>
                  {r.secondary ? <span className="text-muted-foreground"> {r.secondary}</span> : null}
                </span>
                {r.right ? <span className={`shrink-0 text-xs ${r.late ? "text-red-700" : "text-muted-foreground"}`}>{r.right}</span> : null}
              </Link>
              <ViewAssetLink link={r.assetLink} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
