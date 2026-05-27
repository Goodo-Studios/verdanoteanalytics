import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VAULT_TERMINAL_STATUSES } from "../types/vault";

const POLL_INTERVAL_MS = 3000;

/** Polls a single inspiration item until it reaches a terminal status, then
 * stops. Designed to be mounted per-id so multiple in-flight items each get
 * their own polling lifecycle. */
export function useItemStatus(itemId: string | null) {
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!itemId) return;

    const poll = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await supabase
        .from("inspiration_items")
        .select("status, error_message")
        .eq("id", itemId)
        .single();

      if (!data) return;

      queryClient.invalidateQueries({ queryKey: ["vault-item", itemId] });
      queryClient.invalidateQueries({ queryKey: ["vault-items"] });

      if (VAULT_TERMINAL_STATUSES.has(data.status)) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [itemId, queryClient]);
}
