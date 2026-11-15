import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Guards against stale async responses. Call `begin()` right before starting a request; it
 * returns an `isCurrent()` check. A response may only be applied while `isCurrent()` is true.
 * Starting another request, or unmounting, makes every earlier check return false.
 *
 *   const latest = useLatestRequest();
 *   useEffect(() => {
 *     const isCurrent = latest.begin();
 *     load(id).then((rows) => { if (isCurrent()) setRows(rows); });
 *   }, [id]);
 */
export function useLatestRequest(): { begin: () => () => boolean; invalidate: () => void } {
  const counter = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const begin = useCallback(() => {
    const mine = ++counter.current;
    return () => mounted.current && counter.current === mine;
  }, []);

  const invalidate = useCallback(() => {
    counter.current += 1;
  }, []);

  // A stable object, so it is safe in a hook dependency list.
  return useMemo(() => ({ begin, invalidate }), [begin, invalidate]);
}
