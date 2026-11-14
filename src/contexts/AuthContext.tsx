import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type AppRole = "builder" | "employee" | "client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  isLoading: boolean;
  /** Looks the role up again for the signed-in user (the no-access screen's retry button). */
  retryRole: () => void;
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
  retryRole: () => {},
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  isBuilder: false,
  isEmployee: false,
  isClient: false,
});

// A failed role lookup is retried before the app gives up. The waits are in milliseconds: after the
// first failure, then after the second.
export const ROLE_RETRY_DELAYS_MS = [400, 1200];

interface RoleState {
  role: AppRole | null;
  /** True once the lookup for the current identity has finished, whatever it found. */
  resolved: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Role and "resolved" live in one state object so they change together. isLoading is derived from
  // it, so there is never a render with a new user, the previous user's role and isLoading false.
  const [roleState, setRoleState] = useState<RoleState>({ role: null, resolved: false });
  const fetchRoleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The user id whose role is currently held in state. Used to tell a real
  // identity change (sign-in, account switch) apart from a same-user session
  // event (TOKEN_REFRESHED, or the SIGNED_IN that Supabase broadcasts to every
  // other tab when a second tab boots). See the auth-event handler below. It is also
  // how a slow lookup for a previous identity is told apart from the current one.
  const roleUserIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const isCurrent = (userId: string) => mountedRef.current && roleUserIdRef.current === userId;

  const fetchRole = async (userId: string) => {
    // Always resolve, even on error/rejection: a failed role RPC (network blip, transient 5xx)
    // must not leave the app pinned on the loading spinner. Retry a couple of times first. A result
    // for an identity that is no longer current is dropped.
    for (let attempt = 0; attempt <= ROLE_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, ROLE_RETRY_DELAYS_MS[attempt - 1]));
        if (!isCurrent(userId)) return;
      }
      try {
        const { data, error } = await supabase.rpc("get_user_role", { _user_id: userId });
        if (error) throw error;
        if (!isCurrent(userId)) return;
        setRoleState({ role: (data as AppRole) || null, resolved: true });
        // OS-021: a client's first sign-in marks their sent invite accepted. Best effort: a failure
        // here only leaves the staff status as "not yet accepted".
        if (data === "client") {
          void (supabase as unknown as { rpc(name: string): PromiseLike<unknown> }).rpc("os_client_invite_mark_accepted")
            .then(undefined, () => undefined);
        }
        return;
      } catch (err) {
        if (attempt === ROLE_RETRY_DELAYS_MS.length) console.error("Failed to resolve user role:", err);
      }
    }
    if (!isCurrent(userId)) return;
    setRoleState({ role: null, resolved: true });
  };

  // Look the role up again for the signed-in user.
  const retryRole = () => {
    const userId = roleUserIdRef.current;
    if (!userId) return;
    setRoleState({ role: null, resolved: false });
    void fetchRole(userId);
  };

  // isLoading is true while a role is pending (including the post-login fetch window) and false once
  // resolved. This keeps consumers like useRolePrefix() from falling back to the "/builder"
  // default during sign-in, which otherwise causes a visible /builder to /client flash and breaks
  // URL-prefix consumers (the redirect E2E).
  const isLoading = !roleState.resolved;
  const role = roleState.role;

  useEffect(() => {
    mountedRef.current = true;
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
        setRoleState({ role: null, resolved: true });
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
          // new tab"): this branch used to reset the resolved flag unconditionally.
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
          // account — the /builder flash guarded by the US-009 redirect E2E. The previous
          // identity's role is cleared in the same update, so the new user never sees it.
          if (roleUserIdRef.current !== session.user.id) {
            roleUserIdRef.current = session.user.id;
            setRoleState({ role: null, resolved: false });
            if (fetchRoleTimerRef.current !== null) clearTimeout(fetchRoleTimerRef.current);
            fetchRoleTimerRef.current = setTimeout(() => fetchRole(session.user.id), 0);
          }
        } else {
          roleUserIdRef.current = null;
          setRoleState({ role: null, resolved: true });
        }
      }
    );

    return () => {
      mountedRef.current = false;
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
    setRoleState((prev) => ({ ...prev, role: null }));
  };

  const isBuilder = role === "builder";
  const isEmployee = role === "employee";
  const isClient = role === "client";

  return (
    <AuthContext.Provider value={{ user, session, role, isLoading, retryRole, signIn, signOut, isBuilder, isEmployee, isClient }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
