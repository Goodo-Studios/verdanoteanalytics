/**
 * Sign-out and user change cleanup (audit plan item 3.1).
 *
 * When the signed-in user changes (sign-out, or a different person signs in in the same tab):
 *  - requests still running for the previous user are cancelled BEFORE the cache is cleared, so a
 *    slow response cannot put the previous user's data back;
 *  - a builder's "preview as client" (or employee) mode is switched off, so it does not carry over
 *    to the next person in that tab.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let authValue: { user: { id: string } | null };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authValue }));

import { UserSessionBoundary } from "@/components/UserSessionBoundary";
import { useClientPreview } from "@/hooks/useClientPreviewMode";

function PreviewProbe() {
  const { previewRole, setPreviewRole } = useClientPreview();
  return (
    <>
      <div data-testid="role">{previewRole ?? "none"}</div>
      <button onClick={() => setPreviewRole("client")}>preview as client</button>
    </>
  );
}

function setup(client: QueryClient) {
  const ui = () => (
    <QueryClientProvider client={client}>
      <UserSessionBoundary>
        <PreviewProbe />
      </UserSessionBoundary>
    </QueryClientProvider>
  );
  const r = render(ui());
  return { rerender: () => r.rerender(ui()) };
}

describe("UserSessionBoundary", () => {
  let client: QueryClient;
  let calls: string[];

  beforeEach(() => {
    client = new QueryClient();
    calls = [];
    const cancel = client.cancelQueries.bind(client);
    const clear = client.clear.bind(client);
    vi.spyOn(client, "cancelQueries").mockImplementation((...a) => {
      calls.push("cancel");
      return cancel(...(a as Parameters<typeof cancel>));
    });
    vi.spyOn(client, "clear").mockImplementation(() => {
      calls.push("clear");
      clear();
    });
  });

  it("cancels running requests before clearing the cache on sign-out", () => {
    authValue = { user: { id: "user-a" } };
    const { rerender } = setup(client);
    expect(calls).toEqual([]);
    authValue = { user: null };
    rerender();
    expect(calls).toEqual(["cancel", "clear"]);
  });

  it("cancels and clears when a different user signs in in the same tab", () => {
    authValue = { user: { id: "user-a" } };
    const { rerender } = setup(client);
    authValue = { user: { id: "user-b" } };
    rerender();
    expect(calls).toEqual(["cancel", "clear"]);
  });

  it("does nothing on the first sign-in or when the same user re-renders", () => {
    authValue = { user: null };
    const { rerender } = setup(client);
    authValue = { user: { id: "user-a" } };
    rerender();
    rerender();
    expect(calls).toEqual([]);
  });

  it("switches Client Preview off when the user changes", () => {
    authValue = { user: { id: "builder-a" } };
    const { rerender } = setup(client);
    act(() => {
      fireEvent.click(screen.getByText("preview as client"));
    });
    expect(screen.getByTestId("role").textContent).toBe("client");
    authValue = { user: null };
    rerender();
    expect(screen.getByTestId("role").textContent).toBe("none");
  });

  it("keeps Client Preview on while the same user stays signed in", () => {
    authValue = { user: { id: "builder-a" } };
    const { rerender } = setup(client);
    act(() => {
      fireEvent.click(screen.getByText("preview as client"));
    });
    rerender();
    expect(screen.getByTestId("role").textContent).toBe("client");
  });
});
