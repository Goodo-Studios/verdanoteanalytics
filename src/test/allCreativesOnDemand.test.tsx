// Audit 7.5: the Data Export settings section and the brief's creative picker called
// useAllCreatives({}) as soon as they rendered, which runs the slow ?all=1 path over every
// account (about 52,000 creatives). They must load nothing until asked, and the picker must
// load only one account by default.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("@/hooks/useAccountsApi", () => ({
  useAccounts: () => ({ data: [{ id: "act_a", name: "Account A" }, { id: "act_b", name: "Account B" }] }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/contexts/AccountContext", () => ({ useAccountContext: () => ({ selectedAccountId: "act_a" }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "is", "not", "range", "gte", "lte", "neq"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return { supabase: { from: () => chain, rpc: () => Promise.resolve({ data: [], error: null }) } };
});

import { CreativePickerModal } from "@/components/briefs/CreativePickerModal";
import { DataExportSection } from "@/components/settings/DataExportSection";

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const creativesCalls = () => apiFetch.mock.calls.filter((c) => c[0] === "creatives");

describe("all-creatives loads on demand", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue([]);
  });

  it("the creative picker loads nothing while closed or on the Vault tab", async () => {
    const { rerender } = wrap(
      <CreativePickerModal open={false} onClose={() => {}} briefAccountId="act_a" selectedIds={[]} onToggle={() => {}} />,
    );
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CreativePickerModal open onClose={() => {}} briefAccountId="act_a" selectedIds={[]} onToggle={() => {}} />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(creativesCalls()).toEqual([]);
  });

  it("the creative picker loads only the brief's account when its creatives tab opens", async () => {
    wrap(<CreativePickerModal open onClose={() => {}} briefAccountId="act_a" selectedIds={[]} onToggle={() => {}} />);
    const tab = await screen.findByRole("tab", { name: /All Creatives/i });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() => expect(creativesCalls().length).toBe(1));
    const qs = new URLSearchParams(String(creativesCalls()[0][1]).replace(/^\?/, ""));
    expect(qs.get("account_id")).toBe("act_a");
  });

  it("the data export section loads no creatives until an export is clicked", async () => {
    wrap(<DataExportSection />);
    await new Promise((r) => setTimeout(r, 50));
    expect(creativesCalls()).toEqual([]);
  });
});
