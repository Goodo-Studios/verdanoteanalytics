// The jump-to button in the top bar and the Cmd/Ctrl+K shortcut. Staff only: for a client login, or a
// builder previewing the client view, this renders nothing and listens for nothing. The palette itself
// is loaded the first time it is opened, so it adds nothing to the first load.
import { lazy, Suspense, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";

const CommandPalette = lazy(() => import("@/components/CommandPalette"));

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

export function CommandPaletteHost() {
  const { isBuilder, isEmployee, isClient } = useAuth();
  const { isClientPreview } = useClientPreview();
  const enabled = (isBuilder || isEmployee) && !isClient && !isClientPreview;
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLoaded(true);
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        onMouseEnter={() => void import("@/components/CommandPalette")}
        className="flex h-8 items-center gap-2 rounded-md border border-input px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
        aria-label="Jump to a client or page"
        data-testid="command-palette-button"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Jump to</span>
        <kbd className="hidden rounded border border-input px-1 font-sans text-[10px] sm:inline">{isMac() ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {loaded ? (
        <Suspense fallback={null}>
          <CommandPalette open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
