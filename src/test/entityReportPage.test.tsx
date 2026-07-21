/**
 * Entity Report page (Feature 2) — cluster browser.
 *
 * Covers the builder-account-first gate, the headline strip (effective vs
 * distinct entities + coverage), the confidence-tier filter, spend-sorted
 * cards, and drill-in to cluster members.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";

// ─── Mocks: contexts + data hooks ────────────────────────────────────────────
let mockAccountId: string | null = "act_782159176742035";
let mockIsBuilder = true;

vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ selectedAccountId: mockAccountId }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isBuilder: mockIsBuilder }),
}));

const mockReport = vi.fn();
const mockMembers = vi.fn();
vi.mock("@/hooks/useEntityReport", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useEntityReport")>(
    "@/hooks/useEntityReport",
  );
  return {
    ...actual,
    useEntityReport: () => mockReport(),
    useEntityClusterMembers: () => mockMembers(),
  };
});

import EntityReportPage from "@/pages/EntityReportPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EntityReportPage />
    </QueryClientProvider>,
  );
}

const cluster = (over: Record<string, unknown> = {}) => ({
  id: "c1", label: "holiday · ugc", n_creatives: 5, total_spend: 5000,
  confidence_tier: "corroborated", cv_roas: 0.2, cv_ctr: 0.2, cv_cpa: 0.2,
  tag_homogeneity: 1, manual_tag_frac: 0, representative_ad_id: "a1",
  representative_thumbnail: null, representative_ad_name: "Ad 1", spend_share_pct: 62.5,
  // Blended-model fields (US-007).
  analyzed_members: 3, visual_members: 3, script_members: 3, coverage_pct: 60,
  signals: ["visual", "script"],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAccountId = "act_782159176742035";
  mockIsBuilder = true;
  mockMembers.mockReturnValue({ data: [], isLoading: false });
});

describe("EntityReportPage gate", () => {
  it("blocks a non-builder role with a builder-role message", () => {
    mockIsBuilder = false;
    mockReport.mockReturnValue({ data: undefined, isLoading: false, error: null });
    renderPage();
    expect(screen.getByText(/available to the builder role/i)).toBeInTheDocument();
  });

  it("a builder on a non-builder account is NOT gated — the account no longer gates", () => {
    mockAccountId = "act_999";
    mockReport.mockReturnValue({ data: undefined, isLoading: false, error: null });
    renderPage();
    // Role is builder → no gate, regardless of which account is selected.
    expect(screen.queryByText(/available to the builder role/i)).not.toBeInTheDocument();
  });
});

describe("EntityReportPage headline + clusters", () => {
  beforeEach(() => {
    mockReport.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        headline: {
          total_creatives: 100, embedded_creatives: 80, analyzed_creatives: 40,
          clustered_creatives: 80, coverage_pct: 80, analysis_coverage_pct: 40,
          distinct_entities: 11, effective_entities: 4.2, cluster_spend: 8000,
        },
        clusters: [
          cluster(),
          cluster({ id: "c2", label: "sale · curiosity", total_spend: 3000, confidence_tier: "visual_only", spend_share_pct: 37.5 }),
        ],
      },
    });
  });

  it("shows effective + distinct entity headline stats", () => {
    renderPage();
    expect(screen.getByText("4.2")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText(/Effective entities/i)).toBeInTheDocument();
  });

  it("shows the analysis-coverage headline stat", () => {
    renderPage();
    expect(screen.getByText(/Analysis coverage/i)).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText(/40\/100 analyzed/i)).toBeInTheDocument();
  });

  it("surfaces the analysis-coverage caveat when < 100%", () => {
    renderPage();
    // US-007: caveat is keyed on ANALYSIS coverage, not the older embedding coverage.
    expect(
      screen.getByText(/only 40% of creatives .* have been analyzed \(script \+ visual\)/i),
    ).toBeInTheDocument();
  });

  it("renders the exact tier badge + grouping signals on a card", () => {
    mockReport.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        headline: {
          total_creatives: 100, embedded_creatives: 80, analyzed_creatives: 40,
          clustered_creatives: 80, coverage_pct: 80, analysis_coverage_pct: 40,
          distinct_entities: 11, effective_entities: 4.2, cluster_spend: 8000,
        },
        clusters: [
          cluster({
            id: "cx", label: "shared asset pair", confidence_tier: "exact",
            signals: ["exact", "destination"],
          }),
        ],
      },
    });
    renderPage();
    expect(screen.getByText("Exact match")).toBeInTheDocument();
    expect(screen.getByText("Exact asset")).toBeInTheDocument();
    expect(screen.getByText("Same destination")).toBeInTheDocument();
  });

  it("renders a card per cluster", () => {
    renderPage();
    expect(screen.getByText("holiday · ugc")).toBeInTheDocument();
    expect(screen.getByText("sale · curiosity")).toBeInTheDocument();
  });

  it("filters clusters by confidence tier", () => {
    renderPage();
    // open the tier Select and choose Corroborated (scope to the option role so
    // it doesn't collide with the "Corroborated" badge on the card).
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Corroborated" }));
    expect(screen.getByText("holiday · ugc")).toBeInTheDocument();
    expect(screen.queryByText("sale · curiosity")).not.toBeInTheDocument();
  });

  it("opens the drill-in dialog on card click", async () => {
    mockMembers.mockReturnValue({
      data: [{
        ad_id: "a1", ad_name: "Ad One", thumbnail_url: null, preview_url: null,
        spend: 4000, roas: 2.1, ctr: 0.02, cpa: 20, ad_type: "Video",
        person: null, style: null, product: "mixer", hook: "ugc", theme: "holiday",
        tag_source: "parsed", ai_visual_notes: "notes",
      }],
      isLoading: false,
    });
    renderPage();
    fireEvent.click(screen.getByText("holiday · ugc"));
    await waitFor(() => expect(screen.getByText("Ad One")).toBeInTheDocument());
  });
});
