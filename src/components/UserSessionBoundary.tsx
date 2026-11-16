import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ClientPreviewContext, useClientPreviewMode } from "@/hooks/useClientPreviewMode";

/**
 * Per-user state boundary. Provides the Client Preview context and resets per-user state when the
 * signed-in user changes (sign-out, or a different person signing in in the same tab):
 *  - running requests are cancelled first, so a slow response for the previous user cannot write
 *    its data back into the cache after it is cleared;
 *  - the query cache is cleared;
 *  - Client Preview is switched off, so a builder's "preview as client" does not carry over.
 * The first sign-in of a tab (no previous user) resets nothing. Audit plan item 3.1.
 */
export function UserSessionBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const preview = useClientPreviewMode();
  const { exitClientPreview } = preview;
  const previous = useRef<string | null>(null);
  const id = user?.id ?? null;
  useEffect(() => {
    if (previous.current !== null && previous.current !== id) {
      void client.cancelQueries();
      client.clear();
      exitClientPreview();
    }
    previous.current = id;
  }, [id, client, exitClientPreview]);
  return <ClientPreviewContext.Provider value={preview}>{children}</ClientPreviewContext.Provider>;
}
