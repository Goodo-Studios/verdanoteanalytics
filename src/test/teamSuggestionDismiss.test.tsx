/**
 * Suggestion rows in the staff list check can be hidden with an X, the choice is saved per person
 * (table dismissed_suggestions), hidden rows can be shown again, and a failed save puts the row back.
 * The database rules are in supabase/tests/dismissed_suggestions_test.sql.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stored: [] as { surface: string; item_key: string }[],
  insertError: null as { message: string } | null,
  readError: null as { message: string } | null,
}));
const insert = vi.fn();
const del = vi.fn();
const rpc = vi.fn();

function query(table: string) {
  const q = {
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      if (table === "dismissed_suggestions") {
        return Promise.resolve(h.readError ? { data: null, error: h.readError } : { data: h.stored, error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  return q;
}

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isBuilder: true, role: "builder" }) }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => rpc(name, args),
    from: (table: string) => ({
      select: () => query(table),
      insert: (row: unknown) => {
        insert(table, row);
        return Promise.resolve({ data: null, error: h.insertError });
      },
      delete: () => ({
        eq: (c1: string, v1: string) => ({
          eq: (c2: string, v2: string) => {
            del(table, { [c1]: v1, [c2]: v2 });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  },
}));

import TeamPage from "@/features/team/TeamPage";
import type { ReconRow } from "@/features/team/model";

const row = (over: Partial<ReconRow>): ReconRow => ({
  email: "x@example.test", team_member_id: "t-x", team_name: "X", team_role: "producer", team_active: true, user_id: "u-x",
  login_name: null, staff_roles: ["employee"], has_client_role: false, client_linked: false, mapped_role: "employee",
  prepared_invite_id: null, possible_match: null, issues: [], ...over,
});
const RECON: ReconRow[] = [
  row({ email: "nl@example.test", team_member_id: "t-nl", team_name: "No Login", user_id: null, staff_roles: [], issues: ["no_login"] }),
  row({ email: "n1@example.test", team_name: "No Role", user_id: "u-n1", staff_roles: [], issues: ["no_staff_role"] }),
];

const names = () => screen.queryAllByTestId("recon-row").map((r) => r.textContent ?? "");

beforeEach(() => {
  h.stored = [];
  h.insertError = null;
  h.readError = null;
  insert.mockReset();
  del.mockReset();
  rpc.mockReset();
  rpc.mockImplementation((name: string) => Promise.resolve(name === "staff_reconciliation" ? { data: RECON, error: null } : { data: null, error: null }));
});
afterEach(() => cleanup());

describe("hiding staff list check suggestions", () => {
  it("shows an X on each suggestion, and hiding one removes it and saves the choice", async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findAllByTestId("recon-row");
    expect(names()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Hide the suggestion for No Login" }));
    await waitFor(() => expect(names()).toHaveLength(1));
    expect(names()[0]).toContain("No Role");
    expect(insert).toHaveBeenCalledWith("dismissed_suggestions", { surface: "staff_reconciliation", item_key: "nl@example.test:no_login" });
    expect(screen.getByRole("button", { name: "Show 1 hidden suggestion" })).toBeInTheDocument();
  });

  it("starts with the suggestions this person already hid", async () => {
    h.stored = [{ surface: "staff_reconciliation", item_key: "n1@example.test:no_staff_role" }];
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "Show 1 hidden suggestion" });
    expect(names()).toHaveLength(1);
    expect(names()[0]).toContain("No Login");
  });

  it("ignores hidden suggestions that belong to another page", async () => {
    h.stored = [{ surface: "something_else", item_key: "n1@example.test:no_staff_role" }];
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findAllByTestId("recon-row");
    await waitFor(() => expect(names()).toHaveLength(2));
    expect(screen.queryByTestId("recon-hidden")).toBeNull();
  });

  it("lets a hidden suggestion be shown again and deletes the saved choice", async () => {
    h.stored = [{ surface: "staff_reconciliation", item_key: "n1@example.test:no_staff_role" }];
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Show 1 hidden suggestion" }));
    const hidden = within(screen.getByTestId("recon-hidden"));
    fireEvent.click(hidden.getByRole("button", { name: "Show the suggestion for No Role again" }));
    await waitFor(() => expect(names()).toHaveLength(2));
    expect(del).toHaveBeenCalledWith("dismissed_suggestions", { surface: "staff_reconciliation", item_key: "n1@example.test:no_staff_role" });
    expect(screen.queryByTestId("recon-hidden")).toBeNull();
  });

  it("puts the suggestion back and says so when the choice cannot be saved", async () => {
    h.insertError = { message: "permission denied" };
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findAllByTestId("recon-row");
    fireEvent.click(screen.getByRole("button", { name: "Hide the suggestion for No Login" }));
    expect(await screen.findByText("That suggestion could not be hidden. Try again.")).toBeInTheDocument();
    expect(names()).toHaveLength(2);
  });

  it("keeps every suggestion visible when the hidden list cannot load", async () => {
    h.readError = { message: "down" };
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findAllByTestId("recon-row");
    expect(await screen.findByText("Your hidden suggestions could not load.")).toBeInTheDocument();
    expect(names()).toHaveLength(2);
  });

  it("brings a person back when their issues change, because the saved key includes the issue list", async () => {
    h.stored = [{ surface: "staff_reconciliation", item_key: "n1@example.test:no_login" }];
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findAllByTestId("recon-row");
    await waitFor(() => expect(names()).toHaveLength(2));
  });
});
