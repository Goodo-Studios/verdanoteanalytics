import { useCallback, useEffect, useState } from "react";

/**
 * An editable text field backed by a server value (audit plan item 4.2).
 *
 * - Until the user types, the draft follows the server, so text that arrives later (an item still
 *   processing) or changes (a re-analyze) shows up instead of a stale or empty draft.
 * - Blur saves only when the user typed something that differs from the server. Clicking in and
 *   out of a field never writes, so an empty or old draft can never overwrite the real text.
 * - Moving to another item (itemKey changes) drops any unsaved edit and shows that item's text.
 * - After a save the typed text stays on screen until the server returns it, with no flicker
 *   back to the old value.
 */
export function useServerDraft(server: string | null | undefined, itemKey: string | null | undefined) {
  const serverText = server ?? "";
  const [draft, setDraft] = useState(serverText);
  const [dirty, setDirty] = useState(false);
  const [key, setKey] = useState(itemKey);

  // Another item: reset on this render, so the old item's draft is never shown or saved.
  if (key !== itemKey) {
    setKey(itemKey);
    setDraft(serverText);
    setDirty(false);
  }

  useEffect(() => {
    if (!dirty) setDraft(serverText);
    else if (serverText === draft) setDirty(false); // the server caught up with the edit
  }, [serverText, dirty, draft]);

  const onChange = useCallback((value: string) => {
    setDraft(value);
    setDirty(true);
  }, []);

  // Kept for the field's onFocus so callers do not need to know focus does nothing today.
  const onFocus = useCallback(() => {}, []);

  const onBlur = useCallback(
    (save: (value: string) => void) => {
      if (!dirty) return;
      if (draft === serverText) {
        setDirty(false);
        return;
      }
      save(draft);
    },
    [dirty, draft, serverText],
  );

  return { value: draft, onChange, onFocus, onBlur, dirty };
}
