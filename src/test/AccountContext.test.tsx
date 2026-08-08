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

import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/types/account";

const ACCOUNT_A = { id: "acc_a", name: "Bearaby" } as Account;
const ACCOUNT_B = { id: "acc_b", name: "Miracle Brand" } as Account;

const h = vi.hoisted(() => ({
  accounts: [] as Account[],
  isClient: false,
  userId: "user_1" as string | null,
  linkedAccountIds: [] as string[],
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
        eq: () =>
          Promise.resolve({
            data: h.linkedAccountIds.map((account_id) => ({ account_id })),
            error: null,
          }),
      }),
    }),
  },
}));

import { AccountProvider, useAccountContext } from "@/contexts/AccountContext";

function Harness() {
  const { selectedAccountId, accountAccessError } = useAccountContext();
  return (
    <div>
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
