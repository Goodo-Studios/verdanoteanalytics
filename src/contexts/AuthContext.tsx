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
  // The user id whose role is currently held in state. Used to tell a real
  // identity change (sign-in, account switch) apart from a same-user session
  // event (TOKEN_REFRESHED, or the SIGNED_IN that Supabase broadcasts to every
  // other tab when a second tab boots). See the auth-event handler below.
  const roleUserIdRef = useRef<string | null>(null);

  const fetchRole = async (userId: string) => {
    // Always resolve roleResolved, even on error/rejection — otherwise a failed
    // role RPC (network blip, transient 5xx) leaves the app pinned on the
    // loading spinner with no recovery path.
    try {
      const { data, error } = await supabase.rpc("get_user_role", { _user_id: userId });
      if (error) throw error;
      setRole((data as AppRole) || null);
    } catch (err) {
      console.error("Failed to resolve user role:", err);
      setRole(null);
    } finally {
      setRoleResolved(true);
    }
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
        roleUserIdRef.current = session.user.id;
        fetchRole(session.user.id);
      } else {
        roleUserIdRef.current = null;
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
          // Same user, refreshed session — keep the role we already resolved and
          // stay OUT of the loading state.
          //
          // Regression (2026-08-13, "the vault refreshes when I open an ad in a
          // new tab"): this branch used to reset roleResolved unconditionally.
          // Supabase fires onAuthStateChange for TOKEN_REFRESHED, and it
          // broadcasts SIGNED_IN to every other open tab when a new tab boots
          // and picks up the persisted session. Because RoleGuardedRoutes
          // renders a full-screen spinner whenever isLoading is true, each of
          // those routine events unmounted the entire app subtree — AppLayout,
          // the page, and all of its component state — and remounted it a
          // moment later, refetching everything. To the user that is
          // indistinguishable from a full page refresh, and it fired every time
          // they cmd-clicked a card into a second tab.
          //
          // A genuine identity change (first sign-in, switching accounts) still
          // re-enters loading, which is what keeps useRolePrefix() from
          // briefly returning the "/builder" default for a client or employee
          // account — the /builder flash guarded by the US-009 redirect E2E.
          if (roleUserIdRef.current !== session.user.id) {
            roleUserIdRef.current = session.user.id;
            setRoleResolved(false);
            if (fetchRoleTimerRef.current !== null) clearTimeout(fetchRoleTimerRef.current);
            fetchRoleTimerRef.current = setTimeout(() => fetchRole(session.user.id), 0);
          }
        } else {
          roleUserIdRef.current = null;
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
