// Jump-to palette (Cmd/Ctrl+K), staff only. Loaded on first use (see CommandPaletteHost). A search box
// over every client by name and every page of the staff menu, with the arrow keys, Enter and Escape.
// It uses the shared Dialog (Radix), so focus is trapped and returned and Escape closes it.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { useRolePrefix } from "@/hooks/useRolePath";
import { clientItems, pageItems, searchJump } from "@/lib/jumpTo";

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
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].to);
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
          aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
          aria-label="Jump to a client or page"
          placeholder="Jump to a client or page"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="command-palette-input"
        />
        {results.length === 0 ? (
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
      </DialogContent>
    </Dialog>
  );
}
