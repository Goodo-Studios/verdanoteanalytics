import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

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
});
