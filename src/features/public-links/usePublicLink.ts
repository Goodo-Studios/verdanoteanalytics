// Loads one read-only public link (location board, call sheet) and keeps the plain failure reason.
import { useCallback, useEffect, useState } from "react";
import { callPublicLink, type LinkFailure, type LinkType } from "./publicLinkApi";

export function usePublicLink<T>(type: LinkType, token: string) {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<LinkFailure | null>(null);
  const load = useCallback(async () => {
    setFailure(null);
    const r = await callPublicLink<T>({ type, action: "get", token });
    if (r.ok) setData(r.data);
    else setFailure(r.reason);
  }, [type, token]);
  useEffect(() => {
    void load();
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [load]);
  return { data, failure, reload: load };
}
