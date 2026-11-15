/**
 * Creative Library bulk actions: selection is cleared on account or filter change, every bulk
 * action uses the same visible-and-ticked ids, and "Archive all live" asks for confirmation.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let accountId = "acc-1";
const archiveCreatives = vi.fn();
const exportCreativesZip = vi.fn();

vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ selectedAccountId: accountId }),
}));
vi.mock("@/features/creative-library/api", () => ({
  archiveCreatives: (...a: unknown[]) => archiveCreatives(...a),
  exportCreativesZip: (...a: unknown[]) => exportCreativesZip(...a),
}));
vi.mock("@/lib/vaultSave", () => ({ saveCreativeToVault: vi.fn() }));
vi.mock("@/components/CreativeDetailModal", () => ({ CreativeDetailModal: () => null }));
vi.mock("@/features/creative-library/components/GovernedTagEditor", () => ({ GovernedTagEditor: () => null }));
vi.mock("@/features/creative-library/components/LibraryCard", () => ({
  LibraryCard: ({ creative, selected, onToggleSelect }: any) => (
    <label>
      <input
        type="checkbox"
        aria-label={`select ${creative.ad_id}`}
        checked={selected}
        onChange={() => onToggleSelect(creative.ad_id)}
      />
      {creative.ad_name}
    </label>
  ),
}));

const rows = [
  { ad_id: "a1", ad_name: "Alpha", spend: 300 },
  { ad_id: "a2", ad_name: "Beta", spend: 200 },
  { ad_id: "a3", ad_name: "Gamma", spend: 100 },
];
const classification = new Map<string, { klass: string }>([
  ["a1", { klass: "winner" }],
  ["a2", { klass: "loser" }],
  ["a3", { klass: "loser" }],
]);
vi.mock("@/features/creative-library/hooks/useCreativeLibrary", () => ({
  useCreativeLibrary: () => ({
    data: { rows, classification, counts: { winner: 1, loser: 2 } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import CreativeLibraryPage from "@/features/creative-library/CreativeLibraryPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={qc}>
      <CreativeLibraryPage />
    </QueryClientProvider>
  );
  const utils = render(ui());
  return { ...utils, rerenderPage: () => utils.rerender(ui()) };
}

beforeEach(() => {
  accountId = "acc-1";
  archiveCreatives.mockReset();
  exportCreativesZip.mockReset();
  archiveCreatives.mockResolvedValue({ archived: 1 });
  exportCreativesZip.mockResolvedValue({ download_url: null, file_count: 0, error: "x" });
});

describe("Creative Library selection", () => {
  it("clears the selection when the account changes", () => {
    const { rerenderPage } = renderPage();
    fireEvent.click(screen.getByLabelText("select a1"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    accountId = "acc-2";
    rerenderPage();
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
    expect((screen.getByLabelText("select a1") as HTMLInputElement).checked).toBe(false);
  });

  it("clears the selection when the class filter changes, so hidden ads are never sent", async () => {
    renderPage();
    fireEvent.click(screen.getByLabelText("select a2"));
    fireEvent.click(screen.getByLabelText("select a3"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    // Filter chip text starts with the class label; "All" shows every row.
    const chips = screen.getAllByRole("button").filter((b) => b.getAttribute("data-active") !== null);
    const notActive = chips.find((b) => b.getAttribute("data-active") === "false")!;
    fireEvent.click(notActive);
    await waitFor(() => expect(screen.queryByText("2 selected")).not.toBeInTheDocument());
  });

  it("archives and exports exactly the ticked ids", async () => {
    renderPage();
    fireEvent.click(screen.getByLabelText("select a1"));
    fireEvent.click(screen.getByLabelText("select a3"));
    fireEvent.click(screen.getByRole("button", { name: /^Archive$/ }));
    await waitFor(() => expect(archiveCreatives).toHaveBeenCalledTimes(1));
    expect(archiveCreatives).toHaveBeenCalledWith("acc-1", ["a1", "a3"]);
    fireEvent.click(screen.getByRole("button", { name: /Download ZIP/ }));
    await waitFor(() => expect(exportCreativesZip).toHaveBeenCalledWith("acc-1", ["a1", "a3"]));
  });
});

describe("Archive all live confirmation", () => {
  it("does not archive on the first click and states the count in the dialog", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Archive all live/ }));
    expect(archiveCreatives).not.toHaveBeenCalled();
    expect(await screen.findByText("Archive all 3 live creatives?")).toBeInTheDocument();
  });

  it("archives everything (no id list) only after confirming", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Archive all live/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive 3" }));
    await waitFor(() => expect(archiveCreatives).toHaveBeenCalledWith("acc-1", undefined));
  });

  it("cancel leaves everything untouched", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Archive all live/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Archive all 3 live creatives?")).not.toBeInTheDocument());
    expect(archiveCreatives).not.toHaveBeenCalled();
  });
});
