import { useCallback, useRef, useState } from "react";

/**
 * A shared in-flight guard for submit buttons. `run(fn)` ignores a second call while the first is
 * still pending (the ref flips synchronously, so two clicks in the same tick cannot both pass),
 * and `busy` drives the button's disabled state.
 *
 *   const { busy, run } = useBusy();
 *   <Button disabled={busy} onClick={() => run(async () => { await save(); })}>Save</Button>
 */
export function useBusy(): { busy: boolean; run: <T>(fn: () => Promise<T>) => Promise<T | undefined> } {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
