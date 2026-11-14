import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  /** A search box. `label` is the accessible name, for example "Search crew". */
  search?: { value: string; onChange: (value: string) => void; label: string; placeholder?: string };
  /** Selects, toggles and buttons. Use `SelectField` with `hideLabel`. */
  children?: ReactNode;
  /** Pushed to the right edge, for example a count or an Add button. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * The row of filters above a list. The client is chosen in the one switcher at the top of
 * the app, so the bar does not offer a client select of its own: pages read the choice with
 * `useClientSelection()` and filter by it. On small screens the controls wrap.
 */
export function FilterBar({ search, children, trailing, className }: FilterBarProps) {
  return (
    <div role="group" aria-label="Filters" data-testid="filter-bar" className={cn("flex flex-wrap items-end gap-2", className)}>
      {search ? (
        <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label={search.label}
            placeholder={search.placeholder ?? "Search"}
            className="pl-8"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
          />
        </div>
      ) : null}
      {children}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
