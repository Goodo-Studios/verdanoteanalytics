// Debounced os_search for the Cmd/Ctrl+K palette (OS-015). Waits 120 ms after the last key, sends
// nothing under two characters, cancels the request in flight when the text changes, and never
// shows the answer to an older question.
import { useEffect, useState } from "react";
import { MIN_SEARCH_CHARS, type OsSearchRow } from "@/lib/osSearch";
import { fetchOsSearch } from "@/lib/osSearchApi";

export const SEARCH_DEBOUNCE_MS = 120;

export interface OsSearchState {
  rows: OsSearchRow[];
  loading: boolean;
  error: boolean;
  /** The text the rows answer. */
  query: string;
}

const EMPTY: OsSearchState = { rows: [], loading: false, error: false, query: "" };

export function useOsSearch(query: string, enabled = true): OsSearchState {
  const [state, setState] = useState<OsSearchState>(EMPTY);
  const text = query.trim();

  useEffect(() => {
    if (!enabled || text.length < MIN_SEARCH_CHARS) {
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    let current = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    const timer = setTimeout(() => {
      fetchOsSearch(text, controller.signal).then(
        (rows) => {
          if (current) setState({ rows, loading: false, error: false, query: text });
        },
        (err: unknown) => {
          if (!current) return;
          console.warn("os_search failed", err);
          setState({ rows: [], loading: false, error: true, query: text });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, enabled]);

  return state;
}
