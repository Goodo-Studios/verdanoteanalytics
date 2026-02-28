import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "react-router-dom";

export interface PresenceUser {
  user_id: string;
  name: string;
  avatar_url?: string;
  current_page: string;
  last_seen: string;
}

export function usePresence(accountId: string | null) {
  const { user } = useAuth();
  const location = useLocation();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!accountId || !user) {
      setUsers([]);
      return;
    }

    const channelName = `presence:account:${accountId}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    const userPayload: PresenceUser = {
      user_id: user.id,
      name: user.email?.split("@")[0] || "User",
      current_page: location.pathname,
      last_seen: new Date().toISOString(),
    };

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>();
        const allUsers: PresenceUser[] = [];
        for (const key of Object.keys(state)) {
          for (const presence of state[key]) {
            if (presence.user_id !== user.id) {
              allUsers.push(presence);
            }
          }
        }
        setUsers(allUsers);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track(userPayload);
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [accountId, user?.id]);

  // Update presence when page changes
  useEffect(() => {
    if (!channelRef.current || !user) return;
    channelRef.current.track({
      user_id: user.id,
      name: user.email?.split("@")[0] || "User",
      current_page: location.pathname,
      last_seen: new Date().toISOString(),
    });
  }, [location.pathname]);

  return users;
}
