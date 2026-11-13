// Jump-to palette (Cmd/Ctrl+K), staff only. Loaded on first use (see CommandPaletteHost). A search box
// over every client by name and every page of the staff menu, with the arrow keys, Enter and Escape.
// It uses the shared Dialog (Radix), so focus is trapped and returned and Escape closes it.
// OS-015: from two characters it also searches Brain pages (title and body), tasks and clients on
// the server (os_search) and lists them under Pages, Tasks and Clients with the matching line.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { useRolePrefix } from "@/hooks/useRolePath";
import { useOsSearch } from "@/hooks/useOsSearch";
import { clientItems, pageItems, searchJump } from "@/lib/jumpTo";
import { groupResults, parseSnippet } from "@/lib/osSearch";

/** The matching line, with matched words in <mark>. Built from text segments, never from HTML. */
export function Snippet({ text }: { text: string | null }) {
  const parts = parseSnippet(text);
  if (parts.length === 0) return null;
  return (
    <span className="block truncate text-xs text-muted-foreground" data-testid="command-palette-snippet">
      {parts.map((p, i) =>
        p.marked ? (
          <mark key={i} className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-500/30">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const prefix = useRolePrefix();
  const { isBuilder } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  const { clients } = useClientSelection();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const effectiveBuilder = isBuilder && !isClientPreview && !isEmployeePreview;
  const items = useMemo(() => [...clientItems(clients), ...pageItems(effectiveBuilder)], [clients, effectiveBuilder]);
  const results = useMemo(() => searchJump(items, query), [items, query]);
  const search = useOsSearch(query, open);
  const groups = useMemo(() => groupResults(search.rows), [search.rows]);
  // One list for the arrow keys: the jump-to results first, then each search group in order.
  const flat = useMemo(
    () => [
      ...results.map((r) => ({ key: r.id, to: r.to })),
      ...groups.flatMap((g) => g.rows.map((r) => ({ key: `search-${r.kind}-${r.id}`, to: r.url_hint }))),
    ],
    [results, groups],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(`${prefix}${to}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      go(flat[active].to);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] gap-3 sm:top-[20%] sm:translate-y-0 sm:max-w-xl" data-testid="command-palette">
        <DialogTitle className="sr-only">Jump to</DialogTitle>
        <DialogDescription className="sr-only">Type a client or page name, then press Enter to open it.</DialogDescription>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={flat[active] ? `${listId}-${flat[active].key}` : undefined}
          aria-label="Jump to a client or page"
          placeholder="Jump to a client or page"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="command-palette-input"
        />
        {results.length === 0 && groups.length === 0 ? (
          <p className="px-1 py-4 text-sm text-muted-foreground" data-testid="command-palette-empty">Nothing matches that. Try a client name or a page like Casting.</p>
        ) : (
          <ul id={listId} ref={listRef} role="listbox" aria-label="Results" className="max-h-72 overflow-y-auto">
            {results.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${r.id}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(r.to)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-3 py-2 text-sm ${i === active ? "bg-accent" : ""}`}
                data-testid="command-palette-item"
                data-kind={r.kind}
              >
                <span className="truncate font-medium">{r.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{r.hint}</span>
              </li>
            ))}
          </ul>
        )}
        {groups.length > 0 ? (
          <div className="max-h-80 space-y-2 overflow-y-auto" data-testid="command-palette-search">
            {groups.map((g) => (
              <div key={g.kind} data-testid="command-palette-group" data-kind={g.kind}>
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                <ul role="listbox" aria-label={g.label}>
                  {g.rows.map((r) => {
                    const key = `search-${r.kind}-${r.id}`;
                    const i = flat.findIndex((f) => f.key === key);
                    return (
                      <li
                        key={key}
                        id={`${listId}-${key}`}
                        role="option"
                        aria-selected={i === active}
                        onMouseMove={() => setActive(i)}
                        onClick={() => go(r.url_hint)}
                        className={`cursor-pointer rounded-md px-3 py-2 text-sm ${i === active ? "bg-accent" : ""}`}
                        data-testid="command-palette-search-item"
                        data-kind={r.kind}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-medium">{r.title}</span>
                          {r.subtitle ? <span className="shrink-0 text-xs text-muted-foreground">{r.subtitle}</span> : null}
                        </span>
                        {r.kind === "page" ? <Snippet text={r.snippet} /> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        {search.error ? (
          <p className="px-1 text-xs text-muted-foreground" data-testid="command-palette-search-error">Search of pages and tasks is not working right now.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
