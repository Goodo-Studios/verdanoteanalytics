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

  const userId = user?.id ?? null;
  const userName = user?.email?.split("@")[0] || "User";
  const pathname = location.pathname;

  // The latest page, read when the channel (re)subscribes. Supabase fires SUBSCRIBED again
  // after a reconnect; using the value captured when the channel opened would announce the
  // page the user started on.
  const pageRef = useRef(pathname);
  pageRef.current = pathname;

  useEffect(() => {
    if (!accountId || !userId) {
      setUsers([]);
      return;
    }

    const channelName = `presence:account:${accountId}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>();
        const allUsers: PresenceUser[] = [];
        for (const key of Object.keys(state)) {
          for (const presence of state[key]) {
            if (presence.user_id !== userId) {
              allUsers.push(presence);
            }
          }
        }
        setUsers(allUsers);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: userId,
            name: userName,
            current_page: pageRef.current,
            last_seen: new Date().toISOString(),
          } satisfies PresenceUser);
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [accountId, userId, userName]);

  // Update presence when page changes
  useEffect(() => {
    if (!channelRef.current || !userId) return;
    channelRef.current.track({
      user_id: userId,
      name: userName,
      current_page: pathname,
      last_seen: new Date().toISOString(),
    } satisfies PresenceUser);
  }, [pathname, userId, userName]);

  return users;
}
