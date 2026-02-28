import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface CardPresenceUser {
  user_id: string;
  name: string;
  hovered_ad_id: string | null;
}

/**
 * Tracks which creative card each user is hovering on the Creatives page.
 * Uses a dedicated presence channel scoped to the account.
 */
export function useCardPresence(accountId: string | null) {
  const { user } = useAuth();
  const [hoveredCards, setHoveredCards] = useState<Map<string, CardPresenceUser[]>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const currentHoverRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accountId || !user) return;

    const channel = supabase.channel(`card-presence:${accountId}`);
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<CardPresenceUser>();
        const cardMap = new Map<string, CardPresenceUser[]>();

        for (const key of Object.keys(state)) {
          for (const presence of state[key]) {
            if (presence.user_id === user.id) continue;
            if (!presence.hovered_ad_id) continue;
            const existing = cardMap.get(presence.hovered_ad_id) || [];
            existing.push(presence);
            cardMap.set(presence.hovered_ad_id, existing);
          }
        }
        setHoveredCards(cardMap);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: user.id,
            name: user.email?.split("@")[0] || "User",
            hovered_ad_id: null,
          });
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [accountId, user?.id]);

  const setHoveredCard = useCallback((adId: string | null) => {
    if (!channelRef.current || !user) return;
    if (currentHoverRef.current === adId) return;
    currentHoverRef.current = adId;

    channelRef.current.track({
      user_id: user.id,
      name: user.email?.split("@")[0] || "User",
      hovered_ad_id: adId,
    });
  }, [user]);

  return { hoveredCards, setHoveredCard };
}
