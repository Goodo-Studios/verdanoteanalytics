import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type AppRole = "builder" | "employee" | "client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  isBuilder: boolean;
  isEmployee: boolean;
  isClient: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  isLoading: true,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  isBuilder: false,
  isEmployee: false,
  isClient: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleResolved, setRoleResolved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const fetchRoleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRole = async (userId: string) => {
    const { data } = await supabase.rpc("get_user_role", { _user_id: userId });
    setRole((data as AppRole) || null);
    setRoleResolved(true);
  };

  // isLoading tracks role resolution in BOTH directions: true while a role is
  // pending (including the post-login fetch window), false once resolved. This
  // keeps consumers like useRolePrefix() from falling back to the "/builder"
  // default during sign-in — which otherwise causes a visible /builder → /client
  // flash and breaks URL-prefix consumers (the redirect E2E).
  useEffect(() => {
    setIsLoading(!roleResolved);
  }, [roleResolved]);

  useEffect(() => {
    // Seed initial state from cached session immediately — avoids the 3-second
    // spinner caused by calling getSession() inside onAuthStateChange, which
    // can deadlock Supabase's internal auth queue on cold load.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
      } else {
        setRole(null);
        setRoleResolved(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // INITIAL_SESSION is already handled above via getSession() — skip it
        if (event === "INITIAL_SESSION") return;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          // Re-enter the loading state until the new user's role resolves, so
          // useRolePrefix() does not momentarily return the "/builder" default
          // for what is actually a client/employee account (the /builder flash).
          setRoleResolved(false);
          if (fetchRoleTimerRef.current !== null) clearTimeout(fetchRoleTimerRef.current);
          fetchRoleTimerRef.current = setTimeout(() => fetchRole(session.user.id), 0);
        } else {
          setRole(null);
          setRoleResolved(true);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
      if (fetchRoleTimerRef.current !== null) clearTimeout(fetchRoleTimerRef.current);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRole(null);
  };

  const isBuilder = role === "builder";
  const isEmployee = role === "employee";
  const isClient = role === "client";

  return (
    <AuthContext.Provider value={{ user, session, role, isLoading, signIn, signOut, isBuilder, isEmployee, isClient }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
