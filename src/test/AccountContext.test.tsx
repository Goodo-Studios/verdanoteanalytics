// US-008 — Verdanote account deep-linking contract (?account=).
//
// Exercises the REAL AccountProvider (accounts + auth are faked) across the
// four paths the story requires: param present + valid, param absent
// (existing localStorage-restore behaviour must be unchanged), param present
// but unknown, and param present but unauthorised for this user (a client
// whose linked-accounts list doesn't include the requested id). The last two
// must both surface the explicit denial state and must NEVER fall back to a
// previously stored account — that silent fallback is exactly the bug this
// story closes.

import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/types/account";

const ACCOUNT_A = { id: "acc_a", name: "Bearaby" } as Account;
const ACCOUNT_B = { id: "acc_b", name: "Miracle Brand" } as Account;

const h = vi.hoisted(() => ({
  accounts: [] as Account[],
  isClient: false,
  userId: "user_1" as string | null,
  linkedAccountIds: [] as string[],
  linkedError: false,
  linkedGate: null as Promise<void> | null,
  linkedCalls: 0,
}));

vi.mock("@/hooks/useAccountsApi", () => ({
  useAccounts: () => ({ data: h.accounts, isLoading: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isClient: h.isClient, user: h.userId ? { id: h.userId } : null }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => {
          h.linkedCalls += 1;
          if (h.linkedGate) await h.linkedGate;
          if (h.linkedError) return { data: null, error: { message: "network down" } };
          return { data: h.linkedAccountIds.map((account_id) => ({ account_id })), error: null };
        },
      }),
    }),
  },
}));

import { AccountProvider, useAccountContext } from "@/contexts/AccountContext";

function Harness() {
  const { selectedAccountId, accountAccessError, accounts, isLoading } = useAccountContext();
  return (
    <div>
      <span data-testid="accounts">{accounts.map((a) => a.id).join(",") || "none"}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="selected">{selectedAccountId ?? "∅"}</span>
      <span data-testid="error">{String(accountAccessError)}</span>
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccountProvider>
        <Harness />
      </AccountProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  h.accounts = [ACCOUNT_A, ACCOUNT_B];
  h.isClient = false;
  h.userId = "user_1";
  h.linkedAccountIds = [];
  h.linkedError = false;
  h.linkedGate = null;
  h.linkedCalls = 0;
});
afterEach(() => cleanup());

describe("AccountProvider — ?account= deep-link contract (US-008)", () => {
  it("param present and valid: selects that account regardless of stored value", async () => {
    localStorage.setItem("selectedAccountId_user_1", "acc_a");
    renderAt("/builder/analytics?account=acc_b");

    expect(await screen.findByTestId("selected")).toHaveTextContent("acc_b");
    expect(screen.getByTestId("error")).toHaveTextContent("false");
    expect(screen.queryByTestId("account-access-denied")).not.toBeInTheDocument();
  });

  it("param absent: existing localStorage-restore behaviour is unchanged", async () => {
    localStorage.setItem("selectedAccountId_user_1", "acc_b");
    renderAt("/builder/analytics");

    expect(await screen.findByTestId("selected")).toHaveTextContent("acc_b");
    expect(screen.getByTestId("error")).toHaveTextContent("false");
  });

  it("param present but unknown: does not fall back to the stored account, surfaces denial", async () => {
    localStorage.setItem("selectedAccountId_user_1", "acc_a");
    renderAt("/builder/analytics?account=does_not_exist");

    // The denial state replaces the child tree entirely — Harness (and any
    // trace of the previously stored account) never renders alongside it.
    expect(await screen.findByTestId("account-access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("selected")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error")).not.toBeInTheDocument();
  });

  it("param present but unauthorised for this client: does not fall back, surfaces denial", async () => {
    h.isClient = true;
    h.linkedAccountIds = ["acc_a"]; // this client is only linked to acc_a
    localStorage.setItem("selectedAccountId_user_1", "acc_a");
    renderAt("/builder/analytics?account=acc_b"); // acc_b exists, but not for this client

    expect(await screen.findByTestId("account-access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("selected")).not.toBeInTheDocument();
  });
});

describe("AccountProvider: a client's linked accounts (second-round audit L6)", () => {
  beforeEach(() => {
    h.isClient = true;
    h.linkedAccountIds = ["acc_a"];
  });

  it("a failed linked-accounts fetch shows an error with a retry, not a spinner, and retry recovers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.linkedError = true;
    renderAt("/client/overview");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("could not load your accounts");
    expect(screen.queryByTestId("selected")).not.toBeInTheDocument();

    h.linkedError = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent("acc_a"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(h.linkedCalls).toBe(2);
    vi.restoreAllMocks();
  });

  it("shows a client no accounts at all until the linked ids are known", async () => {
    let release!: () => void;
    h.linkedGate = new Promise<void>((resolve) => { release = resolve; });
    renderAt("/client/overview");

    expect(screen.getByTestId("accounts")).toHaveTextContent("none");
    expect(screen.getByTestId("loading")).toHaveTextContent("true");

    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent("acc_a"));
    expect(screen.getByTestId("accounts")).not.toHaveTextContent("acc_b");
  });

  it("rejects ?account=all for a client", async () => {
    renderAt("/client/overview?account=all");
    expect(await screen.findByTestId("account-access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("selected")).not.toBeInTheDocument();
  });

  it("ignores a stored 'all' selection for a client", async () => {
    localStorage.setItem("selectedAccountId_user_1", "all");
    renderAt("/client/overview");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("acc_a"));
  });

  it("still lets staff use ?account=all", async () => {
    h.isClient = false;
    renderAt("/builder/overview?account=all");
    expect(await screen.findByTestId("selected")).toHaveTextContent("all");
  });

  it("drops the previous user's linked ids when the user changes", async () => {
    let release!: () => void;
    const view = renderAt("/client/overview");
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent("acc_a"));

    // A different client signs in. Their lookup is held open: they must not inherit user_1's ids.
    h.userId = "user_2";
    h.linkedAccountIds = ["acc_b"];
    h.linkedGate = new Promise<void>((resolve) => { release = resolve; });
    view.rerender(
      <MemoryRouter initialEntries={["/client/overview"]}>
        <AccountProvider>
          <Harness />
        </AccountProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("accounts")).toHaveTextContent("none");

    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId("accounts")).toHaveTextContent("acc_b"));
    expect(screen.getByTestId("accounts")).not.toHaveTextContent("acc_a");
  });
});

// Audit plan item 3.4. A ?account= link is applied once and then removed from the address, so a
// later refresh of the account list cannot undo the user's own switch. The access-denied screen
// has a way out: "Go to my accounts" clears the bad link and lands on the user's own account.
describe("AccountProvider: ?account= is applied once (audit 3.4)", () => {
  function Switcher() {
    const { selectedAccountId, setSelectedAccountId } = useAccountContext();
    const location = useLocation();
    return (
      <div>
        <span data-testid="selected">{selectedAccountId ?? "∅"}</span>
        <span data-testid="search">{location.search || "none"}</span>
        <button onClick={() => setSelectedAccountId("acc_a")}>switch to A</button>
      </div>
    );
  }
  const tree = (path: string) => (
    <MemoryRouter initialEntries={[path]}>
      <AccountProvider>
        <Switcher />
      </AccountProvider>
    </MemoryRouter>
  );

  it("removes the parameter from the address after applying it, keeping other parameters", async () => {
    render(tree("/builder/analytics?account=acc_b&tab=hooks"));
    expect(await screen.findByTestId("selected")).toHaveTextContent("acc_b");
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent("?tab=hooks"));
  });

  it("a refreshed account list does not undo the user's switch", async () => {
    const view = render(tree("/builder/analytics?account=acc_b"));
    expect(await screen.findByTestId("selected")).toHaveTextContent("acc_b");
    fireEvent.click(screen.getByText("switch to A"));
    expect(screen.getByTestId("selected")).toHaveTextContent("acc_a");
    // The accounts query refetches and returns a new list.
    h.accounts = [{ ...ACCOUNT_A }, { ...ACCOUNT_B }];
    view.rerender(tree("/builder/analytics?account=acc_b"));
    await act(async () => {});
    expect(screen.getByTestId("selected")).toHaveTextContent("acc_a");
  });

  it("the access-denied screen has a button that clears the link and opens the user's own account", async () => {
    localStorage.setItem("selectedAccountId_user_1", "acc_a");
    render(tree("/builder/analytics?account=does_not_exist"));
    const button = await screen.findByRole("button", { name: /go to my accounts/i });
    fireEvent.click(button);
    expect(await screen.findByTestId("selected")).toHaveTextContent("acc_a");
    expect(screen.getByTestId("search")).toHaveTextContent("none");
    expect(screen.queryByTestId("account-access-denied")).not.toBeInTheDocument();
  });
});
