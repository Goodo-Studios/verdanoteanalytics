import { useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";

interface ShortcutOptions {
  onOpenShortcutsModal: () => void;
  onAccountPrev?: () => void;
  onAccountNext?: () => void;
}

function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts({ onOpenShortcutsModal, onAccountPrev, onAccountNext }: ShortcutOptions) {
  const navigate = useNavigate();
  const chordRef = useRef<string | null>(null);
  const chordTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Never capture when inside inputs
      if (isInputFocused()) return;

      const key = e.key.toLowerCase();
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+K handled by CommandBar already
      // ? (Shift+/) → shortcuts modal
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        onOpenShortcutsModal();
        return;
      }

      // Account switching
      if (key === "[") { e.preventDefault(); onAccountPrev?.(); return; }
      if (key === "]") { e.preventDefault(); onAccountNext?.(); return; }

      // G-chord navigation
      if (chordRef.current === "g") {
        clearTimeout(chordTimer.current);
        chordRef.current = null;
        const routes: Record<string, string> = {
          d: "/",
          c: "/creatives",
          a: "/analytics",
          r: "/reports",
          t: "/tagging",
          b: "/briefs",
          s: "/settings",
        };
        if (routes[key]) {
          e.preventDefault();
          navigate(routes[key]);
          return;
        }
      }

      // Start G chord
      if (key === "g" && !meta) {
        chordRef.current = "g";
        clearTimeout(chordTimer.current);
        chordTimer.current = setTimeout(() => { chordRef.current = null; }, 500);
        return;
      }
    },
    [navigate, onOpenShortcutsModal, onAccountPrev, onAccountNext]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(chordTimer.current);
    };
  }, [handleKeyDown]);
}
