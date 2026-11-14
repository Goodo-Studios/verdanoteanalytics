import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth, ROLE_RETRY_DELAYS_MS } from "@/contexts/AuthContext";

const mockUnsub = { unsubscribe: vi.fn() };

function TestConsumer() {
  const { user, role, isLoading, isBuilder, isEmployee, isClient } = useAuth();
  if (isLoading) return <div>loading</div>;
  return (
    <div>
      <div data-testid="user">{user ? (user as any).email : "none"}</div>
      <div data-testid="role">{role ?? "none"}</div>
      <div data-testid="isBuilder">{String(isBuilder)}</div>
      <div data-testid="isEmployee">{String(isEmployee)}</div>
      <div data-testid="isClient">{String(isClient)}</div>
    </div>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: mockUnsub },
    } as any);
  });

  it("resolves with no user when there is no session", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByText("loading")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByText("loading")).not.toBeInTheDocument()
    );

    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(screen.getByTestId("role").textContent).toBe("none");
    expect(screen.getByTestId("isBuilder").textContent).toBe("false");
  });

  it("resolves with role='builder' when session and rpc return builder", async () => {
    const fakeUser = { id: "u1", email: "builder@test.com" };
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: fakeUser } },
      error: null,
    } as any);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: "builder", error: null } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.queryByText("loading")).not.toBeInTheDocument()
    );

    expect(screen.getByTestId("user").textContent).toBe("builder@test.com");
    expect(screen.getByTestId("role").textContent).toBe("builder");
    expect(screen.getByTestId("isBuilder").textContent).toBe("true");
    expect(screen.getByTestId("isEmployee").textContent).toBe("false");
    expect(screen.getByTestId("isClient").textContent).toBe("false");
  });

  it("resolves with role='client' for client users", async () => {
    const fakeUser = { id: "u2", email: "client@brand.com" };
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: fakeUser } },
      error: null,
    } as any);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: "client", error: null } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.queryByText("loading")).not.toBeInTheDocument()
    );

    expect(screen.getByTestId("isClient").textContent).toBe("true");
    expect(screen.getByTestId("isBuilder").textContent).toBe("false");
  });

  it("ignores INITIAL_SESSION event (already handled by getSession)", async () => {
    let changeCallback!: (event: string, session: any) => void;

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      changeCallback = cb;
      return { data: { subscription: mockUnsub } } as any;
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.queryByText("loading")).not.toBeInTheDocument()
    );

    // Fire INITIAL_SESSION — should be a no-op
    changeCallback("INITIAL_SESSION", { user: { id: "x", email: "x@x.com" } });

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("updates to role after SIGNED_IN event", async () => {
    let changeCallback!: (event: string, session: any) => void;

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      changeCallback = cb;
      return { data: { subscription: mockUnsub } } as any;
    });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: "employee", error: null } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.queryByText("loading")).not.toBeInTheDocument()
    );

    // Simulate login via OAuth/magic-link after initial render
    changeCallback("SIGNED_IN", { user: { id: "u3", email: "emp@test.com" } });

    await waitFor(() =>
      expect(screen.getByTestId("isEmployee").textContent).toBe("true")
    );
  });

  it("clears role after SIGNED_OUT event", async () => {
    let changeCallback!: (event: string, session: any) => void;
    const fakeUser = { id: "u4", email: "out@test.com" };

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: fakeUser } },
      error: null,
    } as any);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      changeCallback = cb;
      return { data: { subscription: mockUnsub } } as any;
    });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: "builder", error: null } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("isBuilder").textContent).toBe("true")
    );

    // Simulate sign-out
    changeCallback("SIGNED_OUT", null);

    await waitFor(() =>
      expect(screen.getByTestId("role").textContent).toBe("none")
    );
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  // Regression: the /builder flash. On SIGNED_IN, isLoading MUST return to true
  // until the new user's role resolves. Otherwise a consumer like useRolePrefix()
  // observes role=null with isLoading=false and falls back to the "/builder"
  // default, redirecting a client to /builder/* before settling on /client/* — a
  // visible flash that breaks the client redirect E2E (US-009).
  it("re-enters loading on SIGNED_IN until the new role resolves (no /builder flash)", async () => {
    let changeCallback!: (event: string, session: any) => void;

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      changeCallback = cb;
      return { data: { subscription: mockUnsub } } as any;
    });

    // Deferred rpc so we can observe the window between sign-in and role resolution.
    let resolveRole!: (v: any) => void;
    vi.mocked(supabase.rpc).mockReturnValue(
      new Promise((res) => {
        resolveRole = res;
      }) as any
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Initial no-user resolution settles loading to false.
    await waitFor(() =>
      expect(screen.queryByText("loading")).not.toBeInTheDocument()
    );

    // Sign in — loading must reappear while the role is pending.
    await act(async () => {
      changeCallback("SIGNED_IN", { user: { id: "u9", email: "client@brand.com" } });
    });
    expect(screen.getByText("loading")).toBeInTheDocument();

    // Role resolves — loading clears and the role is the real client role.
    await act(async () => {
      resolveRole({ data: "client", error: null });
    });
    await waitFor(() =>
      expect(screen.queryByText("loading")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("isClient").textContent).toBe("true");
    expect(screen.getByTestId("isBuilder").textContent).toBe("false");
  });

  // Regression (2026-08-13): "the vault does a full page refresh when I open an
  // ad in another tab". Supabase fires TOKEN_REFRESHED on the current tab and
  // broadcasts SIGNED_IN to other tabs when a second tab picks up the persisted
  // session. Both used to reset roleResolved, and RoleGuardedRoutes renders a
  // full-screen spinner whenever isLoading is true — so a routine token refresh
  // unmounted and remounted the whole app. For a SAME-user event, isLoading must
  // never flip back to true and the role must not be re-fetched.
  it.each(["TOKEN_REFRESHED", "SIGNED_IN", "USER_UPDATED"])(
    "stays mounted on a same-user %s event (no spurious remount)",
    async (event) => {
      let changeCallback!: (event: string, session: any) => void;
      const fakeUser = { id: "u5", email: "builder@test.com" };

      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: fakeUser } },
        error: null,
      } as any);
      vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
        changeCallback = cb;
        return { data: { subscription: mockUnsub } } as any;
      });
      vi.mocked(supabase.rpc).mockResolvedValue({ data: "builder", error: null } as any);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() =>
        expect(screen.getByTestId("isBuilder").textContent).toBe("true")
      );
      expect(supabase.rpc).toHaveBeenCalledTimes(1);

      // Same user, refreshed session — must not re-enter the loading state.
      await act(async () => {
        changeCallback(event, { user: { ...fakeUser } });
      });

      expect(screen.queryByText("loading")).not.toBeInTheDocument();
      expect(screen.getByTestId("isBuilder").textContent).toBe("true");
      // And it must not re-resolve a role it already has.
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    }
  );

  // The other half of the contract: switching to a DIFFERENT user must still
  // re-enter loading, or useRolePrefix() briefly returns the "/builder" default
  // for what is really a client account (the /builder flash, US-009).
  it("still re-enters loading when a different user signs in", async () => {
    let changeCallback!: (event: string, session: any) => void;

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "u6", email: "builder@test.com" } } },
      error: null,
    } as any);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      changeCallback = cb;
      return { data: { subscription: mockUnsub } } as any;
    });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: "builder", error: null } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("isBuilder").textContent).toBe("true")
    );

    // Deferred rpc so the window between sign-in and role resolution is observable.
    let resolveRole!: (v: any) => void;
    vi.mocked(supabase.rpc).mockReturnValue(
      new Promise((res) => {
        resolveRole = res;
      }) as any
    );

    await act(async () => {
      changeCallback("SIGNED_IN", { user: { id: "u7", email: "client@brand.com" } });
    });
    expect(screen.getByText("loading")).toBeInTheDocument();

    await act(async () => {
      resolveRole({ data: "client", error: null });
    });
    await waitFor(() =>
      expect(screen.getByTestId("isClient").textContent).toBe("true")
    );
  });

  // Second-round audit M5. Role and isLoading used to change in separate commits, so one render could
  // hold the new user, the previous user's role and isLoading false.
  it("never renders a new user with the previous user's role and isLoading false", async () => {
    let changeCallback!: (event: string, session: any) => void;
    const seen: string[] = [];

    function Recorder() {
      const { user, role, isLoading } = useAuth();
      seen.push(`${(user as any)?.id ?? "none"}|${role ?? "none"}|${isLoading}`);
      return null;
    }

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "m5-a", email: "a@test.com" } } },
      error: null,
    } as any);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      changeCallback = cb;
      return { data: { subscription: mockUnsub } } as any;
    });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: "builder", error: null } as any);

    render(
      <AuthProvider>
        <Recorder />
      </AuthProvider>
    );
    await waitFor(() => expect(seen).toContain("m5-a|builder|false"));

    let resolveRole!: (v: any) => void;
    vi.mocked(supabase.rpc).mockReturnValue(new Promise((res) => { resolveRole = res; }) as any);
    await act(async () => {
      changeCallback("SIGNED_IN", { user: { id: "m5-b", email: "b@test.com" } });
    });
    await act(async () => {
      resolveRole({ data: "client", error: null });
    });
    await waitFor(() => expect(seen).toContain("m5-b|client|false"));

    expect(seen).not.toContain("m5-b|builder|false");
    expect(seen).not.toContain("m5-b|builder|true");
  });

  it("drops a role result that arrives for a user who is no longer current", async () => {
    let changeCallback!: (event: string, session: any) => void;

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "m5-slow", email: "slow@test.com" } } },
      error: null,
    } as any);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      changeCallback = cb;
      return { data: { subscription: mockUnsub } } as any;
    });
    // The first user's lookup stays pending until after the second user has resolved.
    let resolveSlow!: (v: any) => void;
    vi.mocked(supabase.rpc).mockImplementation(((name: string, args: { _user_id: string }) => {
      if (name !== "get_user_role") return Promise.resolve({ data: null, error: null });
      if (args._user_id === "m5-slow") return new Promise((res) => { resolveSlow = res; });
      return Promise.resolve({ data: "client", error: null });
    }) as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));

    await act(async () => {
      changeCallback("SIGNED_IN", { user: { id: "m5-fast", email: "fast@test.com" } });
    });
    await waitFor(() => expect(screen.getByTestId("isClient").textContent).toBe("true"));

    await act(async () => {
      resolveSlow({ data: "builder", error: null });
    });
    expect(screen.getByTestId("isClient").textContent).toBe("true");
    expect(screen.getByTestId("isBuilder").textContent).toBe("false");
  });

  describe("a failed role lookup", () => {
    const originalDelays = [...ROLE_RETRY_DELAYS_MS];
    beforeEach(() => {
      ROLE_RETRY_DELAYS_MS.splice(0, ROLE_RETRY_DELAYS_MS.length, 1, 1);
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      ROLE_RETRY_DELAYS_MS.splice(0, ROLE_RETRY_DELAYS_MS.length, ...originalDelays);
      vi.restoreAllMocks();
    });

    function RetryConsumer() {
      const { role, isLoading, retryRole } = useAuth();
      if (isLoading) return <div>loading</div>;
      return (
        <div>
          <div data-testid="role">{role ?? "none"}</div>
          <button onClick={retryRole}>retry</button>
        </div>
      );
    }

    function signedIn() {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: { id: "m5-retry", email: "r@test.com" } } },
        error: null,
      } as any);
    }

    it("retries and recovers when a later attempt succeeds", async () => {
      signedIn();
      vi.mocked(supabase.rpc)
        .mockResolvedValueOnce({ data: null, error: { message: "blip" } } as any)
        .mockResolvedValueOnce({ data: "employee", error: null } as any);

      render(
        <AuthProvider>
          <RetryConsumer />
        </AuthProvider>
      );

      await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("employee"));
      expect(supabase.rpc).toHaveBeenCalledTimes(2);
    });

    it("gives up after the retries with a null role, and the retry button looks it up again", async () => {
      signedIn();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: "down" } } as any);

      render(
        <AuthProvider>
          <RetryConsumer />
        </AuthProvider>
      );

      await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("none"));
      // One try plus one retry per configured delay.
      expect(supabase.rpc).toHaveBeenCalledTimes(3);

      vi.mocked(supabase.rpc).mockResolvedValue({ data: "client", error: null } as any);
      fireEvent.click(screen.getByText("retry"));
      await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("client"));
    });
  });
});
