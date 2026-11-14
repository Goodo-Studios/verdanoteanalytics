/**
 * The /pipeline board for every client. A client login loads its own rows with
 * no ad account filter, so the row rules decide (rows of its linked ad accounts
 * or of its own clients by `client_slug`). That covers a client with no ad
 * account (client_members only) and a client with several ad accounts. Staff,
 * including a builder previewing as a client, still filter by the selected ad
 * account, because staff have no row limit.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = { isClient: false };
const account = { selectedAccountId: null as string | null, isLoading: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/AccountContext", () => ({ useAccountContext: () => account }));

const board = [
  { id: "r1", task_name: "Slug-only card", stage: "Editing", due_date: null, content_type: "Video", updated_at: null },
];
// The board table has the card; the delivered list and the engagements are empty here (the cycle
// view and the delivered list have their own tests).
const tableRows = (table: string) => (table === "pipeline_tasks" ? board : []);
const from = vi.fn();
const eq = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      from(table);
      return {
        select: () => {
          const result = Promise.resolve({ data: tableRows(table), error: null });
          return Object.assign(result, {
            eq: (col: string, val: string) => {
              eq(col, val);
              return Promise.resolve({ data: tableRows(table), error: null });
            },
          });
        },
      };
    },
  },
}));

import ContentPipelinePage from "@/pages/ContentPipelinePage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContentPipelinePage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  from.mockReset();
  eq.mockReset();
  auth.isClient = false;
  account.selectedAccountId = null;
  account.isLoading = false;
});

describe("Content Pipeline board by client", () => {
  it("a client with no ad account gets its board without choosing an account", async () => {
    auth.isClient = true;
    account.selectedAccountId = null;
    renderPage();

    expect(await screen.findByText("Slug-only card")).toBeInTheDocument();
    expect(from).toHaveBeenCalledWith("pipeline_tasks");
    expect(eq).not.toHaveBeenCalled();
    expect(screen.queryByText(/pick a client/i)).toBeNull();
  });

  it("a client with an ad account selected still loads all its own rows, not one account", async () => {
    auth.isClient = true;
    account.selectedAccountId = "act_one_of_several";
    renderPage();

    expect(await screen.findByText("Slug-only card")).toBeInTheDocument();
    expect(eq).not.toHaveBeenCalled();
  });

  it("the client board stays read-only", async () => {
    auth.isClient = true;
    const { container } = renderPage();
    await screen.findByText("Slug-only card");
    expect(container.querySelector("button, a, input, textarea, form")).toBeNull();
  });

  it("staff filter by the selected ad account", async () => {
    account.selectedAccountId = "act_demo";
    renderPage();

    expect(await screen.findByText("Slug-only card")).toBeInTheDocument();
    expect(eq).toHaveBeenCalledWith("account_id", "act_demo");
  });

  it("staff with no account selected are asked to pick one and load nothing", async () => {
    renderPage();

    expect(screen.getByText(/pick a client in the switcher.*content pipeline/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(from).not.toHaveBeenCalled();
  });

  it("staff on the agency view load nothing", async () => {
    account.selectedAccountId = "all";
    renderPage();

    expect(screen.getByText(/pick a client/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(from).not.toHaveBeenCalled();
  });

  it("nothing loads while accounts are still resolving", async () => {
    auth.isClient = true;
    account.isLoading = true;
    renderPage();

    expect(screen.getByTestId("pipeline-loading")).toBeInTheDocument();
    await waitFor(() => expect(from).not.toHaveBeenCalled());
  });
});
