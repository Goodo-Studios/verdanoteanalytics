import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * A set of selected ids that belongs to one scope (for example the selected account). When the
 * scope changes the selection is empty on that same render, so a bulk action can never run on ids
 * picked in another scope. Switching back does not bring the old selection back.
 * Audit plan item 3.2.
 */
export function useScopedSelection(scope: string | null): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [state, setState] = useState<{ scope: string | null; ids: Set<string> }>(() => ({ scope, ids: new Set() }));
  // Scope changed: drop the old selection now (state update during render, React's documented
  // pattern for resetting state on a prop change), and show nothing for this render.
  if (state.scope !== scope) setState({ scope, ids: new Set() });
  const ids = state.scope === scope ? state.ids : (EMPTY as Set<string>);
  const setIds = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (next) =>
      setState((prev) => {
        const base = prev.scope === scope ? prev.ids : new Set<string>();
        return { scope, ids: typeof next === "function" ? next(base) : next };
      }),
    [scope],
  );
  return [ids, setIds];
}
