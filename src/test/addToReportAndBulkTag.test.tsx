/**
 * Add to Report and Bulk Tag (audit plan item 5.7).
 *
 * - Add to Report merged into the CACHED report, so a second quick addition wrote
 *   over the first. It now reads the report fresh before writing and refreshes
 *   ["reports"] afterwards.
 * - Bulk Tag kept the last choices when reopened, and every creative showed its
 *   own "Tags updated" message. It now resets on open and shows one summary.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";

// ── Reports: the cache is stale (only A); the database already has A and B. ──
let dbTopPerformers: string;
const reportWrites: Array<Record<string, unknown>> = [];

vi.mock("@/hooks/useReportsApi", () => ({
  useReports: () => ({
    data: [{ id: "r1", report_name: "June", created_at: "2026-06-30", creative_count: 1, top_performers: JSON.stringify([{ ad_id: "A" }]) }],
    isLoading: false,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      b.select = () => b;
      b.eq = () => b;
      b.update = (p: Record<string, unknown>) => { patch = p; return b; };
      b.single = () => Promise.resolve({ data: { id: "r1", report_name: "June", top_performers: dbTopPerformers }, error: null });
      b.maybeSingle = b.single;
      b.then = (resolve: (v: unknown) => void) => {
        if (patch) {
          reportWrites.push(patch);
          dbTopPerformers = String(patch.top_performers);
        }
        return resolve({ data: null, error: null });
      };
      return b;
    },
  },
}));

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AddToReportModal } from "@/components/creatives/AddToReportModal";
import { BulkTagModal } from "@/components/creatives/BulkTagModal";

let qc: QueryClient;
function Wrap({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  reportWrites.length = 0;
  dbTopPerformers = JSON.stringify([{ ad_id: "A" }, { ad_id: "B" }]);
});

describe("Add to Report", () => {
  it("keeps creatives another addition already saved, and refreshes the reports list", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(
      <Wrap>
        <AddToReportModal open onClose={() => {}} adIds={["C"]} creatives={[{ ad_id: "C", ad_name: "C ad" }]} />
      </Wrap>,
    );
    fireEvent.click(screen.getByText("June"));
    fireEvent.click(screen.getByRole("button", { name: /add to report/i }));

    await waitFor(() => expect(reportWrites).toHaveLength(1));
    const ids = (JSON.parse(String(reportWrites[0].top_performers)) as Array<{ ad_id: string }>).map((p) => p.ad_id);
    expect(ids).toEqual(["A", "B", "C"]);
    await waitFor(() =>
      expect(spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))).toContain('["reports"]'),
    );
  });
});

describe("Bulk Tag", () => {
  it("starts empty every time it opens", () => {
    const { rerender } = render(<Wrap><BulkTagModal open onClose={() => {}} adIds={["a1"]} /></Wrap>);
    fireEvent.change(screen.getByLabelText(/hook/i), { target: { value: "Did you know" } });
    rerender(<Wrap><BulkTagModal open={false} onClose={() => {}} adIds={["a1"]} /></Wrap>);
    rerender(<Wrap><BulkTagModal open onClose={() => {}} adIds={["a1"]} /></Wrap>);
    expect((screen.getByLabelText(/hook/i) as HTMLInputElement).value).toBe("");
  });

  it("shows one summary instead of a message per creative", async () => {
    render(<Wrap><BulkTagModal open onClose={() => {}} adIds={["a1", "a2", "a3"]} /></Wrap>);
    fireEvent.change(screen.getByLabelText(/hook/i), { target: { value: "Did you know" } });
    fireEvent.click(screen.getByRole("button", { name: /apply to 3 creatives/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.success).mock.calls[0][0])).toMatch(/3 creatives/);
  });
});
