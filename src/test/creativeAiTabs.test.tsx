/**
 * CreativeAiTabs — the full-parity AI surface added to the analytics creative
 * modal (Script / Framework / Analysis + the Vault-parity header), mirroring the
 * live Creative Vault detail view.
 *
 * Coverage:
 *   • Tabs render the extracted fields (script + word count, framework, analysis).
 *   • Editable: staff get textareas that persist to the creatives columns on blur.
 *   • Star: toggling a hook star writes hook_verbal_saved.
 *   • Actions: Re-analyze re-queues the creative; Add-to-board / Share are gated
 *     on the creative being saved to the Vault.
 *   • Read-only: clients see the values without edit affordances.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// ── supabase mock: chainable update().eq() terminal + functions.invoke ────────
const updateCalls: Array<Record<string, unknown>> = [];
const invokeCalls: Array<{ fn: string; body: unknown }> = [];

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  builder.update = vi.fn((payload: Record<string, unknown>) => {
    updateCalls.push(payload);
    return builder;
  });
  // `.eq()` is the awaited terminal for update — thenable resolving success.
  builder.eq = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => void) => resolve({ error: null });
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => makeBuilder()),
    functions: {
      invoke: vi.fn(async (fn: string, opts: { body: unknown }) => {
        invokeCalls.push({ fn, body: opts?.body });
        return { data: { ok: true }, error: null };
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Add-to-board / Share reuse the real Vault components — stub to trivial markers
// so the test can assert they render (enabled) without their own data fetches.
vi.mock("@/features/vault/components/AddToBoardModal", () => ({
  AddToBoardModal: ({ open }: { open: boolean }) =>
    open ? <div>add-to-board-modal</div> : null,
}));
vi.mock("@/features/vault/components/VaultShareControl", () => ({
  VaultShareControl: () => <div>vault-share-control</div>,
}));

import {
  CreativeScriptTab,
  CreativeFrameworkTab,
  CreativeAnalysisTab,
  CreativeAiHeader,
} from "@/components/creative-detail/CreativeAiTabs";
import type { CreativeAiDetail } from "@/hooks/useCreativeAiDetail";

const analyzed: CreativeAiDetail = {
  brand_name: "Acme Sleep",
  industry: "Wellness",
  ad_format: "UGC Video",
  target_audience: "Adults 30-50 who struggle with sleep",
  copywriting_framework: "AIDA",
  hook_type: "bold_claim",
  hook_verbal: "Your sleep is broken and here is the fix",
  hook_text: "STOP scrolling",
  hook_visual: null,
  hook_formula: "[CLAIM] [TOPIC] [RESULT]",
  value_structure: "before-after transformation",
  cta_type: "shop",
  cta_formula: "[ACTION] [PRODUCT] today",
  fill_in_blank_script: "Hook: ___ Body: ___ CTA: ___",
  framework_json: { raw: true },
  hook_verbal_saved: false,
  hook_text_saved: false,
  hook_visual_saved: false,
  ai_analysis: "The script leads with a strong problem callout.",
  ai_hook_analysis: "Bold-claim hook lands in the first second.",
  ai_cta_notes: "CTA is clear and product-focused.",
  ai_visual_notes: "Clean studio lighting with product hero.",
  analysis_status: "done",
  analyzed_at: "2026-07-22T00:00:00Z",
  transcript: "Hey there friend now",
  transcript_status: "ready",
};

const render_ = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

beforeEach(() => {
  updateCalls.length = 0;
  invokeCalls.length = 0;
  vi.clearAllMocks();
});

describe("Script tab", () => {
  it("renders the cleaned script with a client-computed word count", () => {
    render_(<CreativeScriptTab adId="ad1" detail={analyzed} isLoading={false} canEdit />);
    expect(screen.getByText("4 words")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hey there friend now")).toBeInTheDocument();
  });

  it("persists an edited script to creatives.transcript on blur (staff)", async () => {
    render_(<CreativeScriptTab adId="ad1" detail={analyzed} isLoading={false} canEdit />);
    const box = screen.getByDisplayValue("Hey there friend now");
    fireEvent.change(box, { target: { value: "Totally new script text" } });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(updateCalls).toContainEqual({ transcript: "Totally new script text" }),
    );
  });

  it("is read-only for clients (no textarea)", () => {
    render_(
      <CreativeScriptTab adId="ad1" detail={analyzed} isLoading={false} canEdit={false} />,
    );
    expect(screen.queryByDisplayValue("Hey there friend now")).toBeNull();
    expect(screen.getByText("Hey there friend now")).toBeInTheDocument();
  });
});

describe("Framework tab", () => {
  it("renders the extracted framework fields with the hook-type badge", () => {
    render_(<CreativeFrameworkTab adId="ad1" detail={analyzed} isLoading={false} canEdit />);
    expect(screen.getByText("Content Framework")).toBeInTheDocument();
    expect(screen.getByText("AIDA")).toBeInTheDocument();
    expect(screen.getByText("Bold Claim")).toBeInTheDocument(); // hook-type badge
    expect(
      screen.getByDisplayValue("Your sleep is broken and here is the fix"),
    ).toBeInTheDocument();
    // Visual hook renders even though empty (editable → textarea present).
    expect(screen.getByText("Visual Hook")).toBeInTheDocument();
  });

  it("saves an edited framework field back to creatives on blur", async () => {
    render_(<CreativeFrameworkTab adId="ad1" detail={analyzed} isLoading={false} canEdit />);
    const verbal = screen.getByDisplayValue("Your sleep is broken and here is the fix");
    fireEvent.change(verbal, { target: { value: "Reworded verbal hook" } });
    fireEvent.blur(verbal);
    await waitFor(() =>
      expect(updateCalls).toContainEqual({ hook_verbal: "Reworded verbal hook" }),
    );
  });

  it("toggling a hook star writes hook_verbal_saved", async () => {
    render_(<CreativeFrameworkTab adId="ad1" detail={analyzed} isLoading={false} canEdit />);
    // Three unstarred hooks (verbal/text/visual) — the first is the verbal hook.
    const stars = screen.getAllByTitle("Save to Hook Library");
    fireEvent.click(stars[0]);
    await waitFor(() =>
      expect(updateCalls).toContainEqual({ hook_verbal_saved: true }),
    );
  });
});

describe("Analysis tab", () => {
  it("renders exactly two sections: Script + Visual analysis", () => {
    render_(<CreativeAnalysisTab adId="ad1" detail={analyzed} isLoading={false} canEdit />);
    expect(screen.getByText("Script Analysis")).toBeInTheDocument();
    expect(screen.getByText("Visual Analysis")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("The script leads with a strong problem callout."),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Clean studio lighting with product hero."),
    ).toBeInTheDocument();
  });

  it("persists visual analysis to ai_visual_notes on blur", async () => {
    render_(<CreativeAnalysisTab adId="ad1" detail={analyzed} isLoading={false} canEdit />);
    const visual = screen.getByDisplayValue("Clean studio lighting with product hero.");
    fireEvent.change(visual, { target: { value: "New visual note" } });
    fireEvent.blur(visual);
    await waitFor(() =>
      expect(updateCalls).toContainEqual({ ai_visual_notes: "New visual note" }),
    );
  });
});

describe("Vault-parity header", () => {
  const baseHeader = {
    adId: "ad1",
    accountId: "act_1",
    platform: "facebook_ad",
    dateIso: "2026-07-02T00:00:00Z",
    detail: analyzed,
    canEdit: true,
  };

  it("renders brand, industry/ad_format chips, and target audience", () => {
    render_(
      <CreativeAiHeader {...baseHeader} vaultItemId={null} vaultShareToken={null} />,
    );
    expect(screen.getByText("Acme Sleep")).toBeInTheDocument();
    expect(screen.getByText("Wellness")).toBeInTheDocument();
    expect(screen.getByText("UGC Video")).toBeInTheDocument();
    expect(
      screen.getByText("Adults 30-50 who struggle with sleep"),
    ).toBeInTheDocument();
  });

  it("Re-analyze re-queues the creative (pending + cleared analyzed_at) and pokes analyze-creative", async () => {
    render_(
      <CreativeAiHeader {...baseHeader} vaultItemId={null} vaultShareToken={null} />,
    );
    fireEvent.click(screen.getByLabelText("Re-analyze creative"));
    await waitFor(() =>
      expect(updateCalls).toContainEqual({
        analysis_status: "pending",
        analyzed_at: null,
      }),
    );
    await waitFor(() =>
      expect(invokeCalls).toContainEqual({
        fn: "analyze-creative",
        body: { account_id: "act_1" },
      }),
    );
  });

  it("disables Add-to-board / Share until the creative is saved to the Vault", () => {
    render_(
      <CreativeAiHeader {...baseHeader} vaultItemId={null} vaultShareToken={null} />,
    );
    expect(screen.getByLabelText("Add to board")).toBeDisabled();
    expect(screen.getByLabelText("Share")).toBeDisabled();
    expect(screen.queryByText("vault-share-control")).toBeNull();
  });

  it("enables Add-to-board and the real Share control once saved to the Vault", () => {
    render_(
      <CreativeAiHeader
        {...baseHeader}
        vaultItemId="item-123"
        vaultShareToken={null}
      />,
    );
    expect(screen.getByLabelText("Add to board")).not.toBeDisabled();
    // Real VaultShareControl (stubbed marker) renders instead of the disabled stub.
    expect(screen.getByText("vault-share-control")).toBeInTheDocument();
  });

  it("hides the staff action row for clients (read-only)", () => {
    render_(
      <CreativeAiHeader
        {...baseHeader}
        canEdit={false}
        vaultItemId={null}
        vaultShareToken={null}
      />,
    );
    expect(screen.queryByLabelText("Re-analyze creative")).toBeNull();
    expect(screen.queryByLabelText("Add to board")).toBeNull();
    // Metadata still renders for everyone.
    expect(screen.getByText("Acme Sleep")).toBeInTheDocument();
  });
});
