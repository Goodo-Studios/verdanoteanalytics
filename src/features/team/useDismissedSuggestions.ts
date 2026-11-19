// Per-person dismissals for suggestion rows (table dismissed_suggestions, migration
// 20261217010001). A person hides a suggestion with the X and can bring it back; the choice is
// kept in the database, so it follows them across browsers. The table is not in the generated
// types, so it is reached through a narrow local type.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DbResult {
  data: unknown;
  error: { message: string } | null;
}
interface Query extends PromiseLike<DbResult> {
  order(column: string, options?: { ascending: boolean }): Query;
}
interface Untyped {
  from(table: string): {
    select(columns: string): Query;
    insert(row: Record<string, unknown>): PromiseLike<DbResult>;
    delete(): { eq(column: string, value: string): { eq(column: string, value: string): PromiseLike<DbResult> } };
  };
}
const db = supabase as unknown as Untyped;
const TABLE = "dismissed_suggestions";

export interface DismissedSuggestions {
  /** Keys this person has hidden on this surface. */
  dismissed: Set<string>;
  isLoaded: boolean;
  error: string | null;
  dismiss: (key: string) => Promise<void>;
  restore: (key: string) => Promise<void>;
}

export function useDismissedSuggestions(surface: string, enabled = true): DismissedSuggestions {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [isLoaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void Promise.resolve(db.from(TABLE).select("surface, item_key").order("dismissed_at", { ascending: false })).then((r) => {
      if (!live) return;
      if (r.error) {
        // A failed read shows every suggestion again rather than hiding any of them.
        setError("Your hidden suggestions could not load.");
      } else {
        const rows = (r.data ?? []) as { surface: string; item_key: string }[];
        setDismissed(new Set(rows.filter((x) => x.surface === surface).map((x) => x.item_key)));
        setError(null);
      }
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [surface, enabled]);

  const dismiss = useCallback(
    async (key: string) => {
      setDismissed((prev) => new Set(prev).add(key));
      const { error: e } = await db.from(TABLE).insert({ surface, item_key: key });
      // A row that is already there (23505 shows as the same message text) leaves it hidden.
      if (e && !/duplicate key/i.test(e.message)) {
        setDismissed((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setError("That suggestion could not be hidden. Try again.");
      } else {
        setError(null);
      }
    },
    [surface],
  );

  const restore = useCallback(
    async (key: string) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      const { error: e } = await db.from(TABLE).delete().eq("surface", surface).eq("item_key", key);
      if (e) {
        setDismissed((prev) => new Set(prev).add(key));
        setError("That suggestion could not be brought back. Try again.");
      } else {
        setError(null);
      }
    },
    [surface],
  );

  return { dismissed, isLoaded, error, dismiss, restore };
}
