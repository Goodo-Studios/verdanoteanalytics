// "Sync from name": dry-run preview, confirm to apply, refresh, visible errors.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a), info: vi.fn() } }));

const auth = { isBuilder: true, isEmployee: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

import { SyncFromNameDialog } from "@/components/creatives/SyncFromNameDialog";
import { CreativeTagEditor } from "@/components/creative-detail/CreativeTagEditor";
import { BulkActionBar } from "@/components/creatives/BulkActionBar";
import { syncFromName, summarizeSyncPreview, SYNC_FROM_NAME_MAX_IDS, type SyncFromNameResponse } from "@/lib/syncFromName";
import { useCreatives } from "@/hooks/useCreatives";

const EMPTY = { ad_type: null, person: null, style: null, product: null, hook: null, theme: null };

const PREVIEW: SyncFromNameResponse = {
  applied: false,
  changes: [
    {
      id: "ad-1", ad_name: "GS200001_Static_Founder_StudioClean_Blanket_TiredBy3pm_Sleep", changed: true,
      before: { ...EMPTY, ad_type: "Image", person: "Creator", style: "Studio Clean", product: "Blanket", hook: "Old hook (manual)", theme: "Sleep" },
      after: { ad_type: "Static", person: "Founder", style: "Studio Clean", product: "Blanket", hook: "Tired By 3pm", theme: "Sleep" },
    },
    {
      id: "ad-2", ad_name: "GS200002_Video_Creator_UGCNative_Blanket_Hook_Theme", changed: false,
      before: { ad_type: "Video", person: "Creator", style: "UGC Native", product: "Blanket", hook: "Hook", theme: "Theme" },
      after: { ad_type: "Video", person: "Creator", style: "UGC Native", product: "Blanket", hook: "Hook", theme: "Theme" },
    },
  ],
};

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiFetch.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("summarizeSyncPreview", () => {
  it("lists only changed fields per ad and counts unchanged ads", () => {
    const s = summarizeSyncPreview(PREVIEW, 3);
    expect(s.unchangedCount).toBe(1);
    expect(s.missingCount).toBe(1);
    expect(s.changed).toHaveLength(1);
    expect(s.changed[0].diffs.map((d) => [d.label, d.before, d.after])).toEqual([
      ["Ad Type", "Image", "Static"],
      ["Person", "Creator", "Founder"],
      ["Hook", "Old hook (manual)", "Tired By 3pm"],
    ]);
  });
});

describe("syncFromName client", () => {
  it("posts { ids, dry_run } to creatives/sync-from-name", async () => {
    apiFetch.mockResolvedValue(PREVIEW);
    await syncFromName(["ad-1", "ad-2", "ad-1"], true);
    expect(apiFetch).toHaveBeenCalledWith("creatives", "sync-from-name", {
      method: "POST", body: JSON.stringify({ ids: ["ad-1", "ad-2"], dry_run: true }),
    });
  });

  it("splits more than 500 ids into batches and merges the changes", async () => {
    apiFetch.mockImplementation(async (_fn: string, _path: string, opts: { body: string }) => {
      const { ids } = JSON.parse(opts.body);
      return { applied: true, changes: ids.map((id: string) => ({ id, ad_name: id, before: EMPTY, after: EMPTY, changed: false })) };
    });
    const ids = Array.from({ length: SYNC_FROM_NAME_MAX_IDS + 20 }, (_, i) => `ad-${i}`);
    const resp = await syncFromName(ids, false);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(resp.changes).toHaveLength(ids.length);
    expect(resp.applied).toBe(true);
  });

  it("surfaces the server error message", async () => {
    apiFetch.mockRejectedValue(new Error("ids array required"));
    await expect(syncFromName(["ad-1"], true)).rejects.toThrow("Sync from name failed: ids array required");
  });
});

describe("SyncFromNameDialog", () => {
  it("previews before→after with an unchanged count, then applies and refreshes on confirm", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const onClose = vi.fn();
    const onApplied = vi.fn();
    apiFetch.mockResolvedValueOnce(PREVIEW).mockResolvedValueOnce({ ...PREVIEW, applied: true });

    render(<SyncFromNameDialog open onClose={onClose} onApplied={onApplied} adIds={["ad-1", "ad-2"]} />, { wrapper: wrap(qc) });

    expect(await screen.findByTestId("sync-summary")).toHaveTextContent("1 ad will change, 1 unchanged");
    expect(apiFetch).toHaveBeenNthCalledWith(1, "creatives", "sync-from-name", expect.objectContaining({
      body: JSON.stringify({ ids: ["ad-1", "ad-2"], dry_run: true }),
    }));
    const change = screen.getByTestId("sync-change");
    expect(change).toHaveTextContent("GS200001_Static_Founder_StudioClean_Blanket_TiredBy3pm_Sleep");
    expect(change).toHaveTextContent("Old hook (manual)");
    expect(change).toHaveTextContent("Tired By 3pm");
    expect(change).toHaveTextContent("Image");
    expect(change).toHaveTextContent("Static");
    // Nothing is written until the user confirms.
    expect(apiFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Apply to 2 ads" }));

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenNthCalledWith(2, "creatives", "sync-from-name", expect.objectContaining({
      body: JSON.stringify({ ids: ["ad-1", "ad-2"], dry_run: false }),
    }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["creatives"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["all-creatives"] });
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("shows a preview error in the dialog and as a toast, and never applies", async () => {
    const qc = new QueryClient();
    apiFetch.mockRejectedValueOnce(new Error("Access denied"));
    render(<SyncFromNameDialog open onClose={() => {}} adIds={["ad-1"]} />, { wrapper: wrap(qc) });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Preview failed");
    expect(alert).toHaveTextContent("Access denied");
    expect(toastError).toHaveBeenCalledWith("Couldn't preview Sync from name", { description: expect.stringContaining("Access denied") });
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("shows an apply error and keeps the dialog open", async () => {
    const qc = new QueryClient();
    const onClose = vi.fn();
    apiFetch.mockResolvedValueOnce(PREVIEW).mockRejectedValueOnce(new Error("boom"));
    render(<SyncFromNameDialog open onClose={onClose} adIds={["ad-1", "ad-2"]} />, { wrapper: wrap(qc) });
    fireEvent.click(await screen.findByRole("button", { name: "Apply to 2 ads" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sync failed");
    expect(alert).toHaveTextContent("boom");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("useCreatives read-side mapping", () => {
  it("returns legacy ad_type Image rows as Static", async () => {
    apiFetch.mockResolvedValue({ data: [{ ad_id: "a", ad_type: "Image" }, { ad_id: "b", ad_type: "Video" }], total: 2 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCreatives({}, 0), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.data.map((r) => r.ad_type)).toEqual(["Static", "Video"]);
  });
});

describe("Sync from name entry points", () => {
  it("the single-ad tag editor has a Sync from name button that opens the preview", async () => {
    apiFetch.mockResolvedValue(PREVIEW);
    const qc = new QueryClient();
    render(<CreativeTagEditor creative={{ ad_id: "ad-1", ad_type: "Video", style: "UGC Native", hook: "Tired By 3pm" }} />, { wrapper: wrap(qc) });
    // Labels + hook is a free-text input in the editor.
    expect(screen.getByText("Creative Type")).toBeInTheDocument();
    expect(screen.queryByText("Style")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Hook")).toHaveValue("Tired By 3pm");
    fireEvent.click(screen.getByRole("button", { name: /Sync from name/ }));
    expect(await screen.findByTestId("sync-summary")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("creatives", "sync-from-name", expect.objectContaining({
      body: JSON.stringify({ ids: ["ad-1"], dry_run: true }),
    }));
  });

  it("clients do not see the single-ad Sync from name button", () => {
    auth.isBuilder = false;
    try {
      render(<CreativeTagEditor creative={{ ad_id: "ad-1" }} />, { wrapper: wrap(new QueryClient()) });
      expect(screen.queryByRole("button", { name: /Sync from name/ })).not.toBeInTheDocument();
    } finally {
      auth.isBuilder = true;
    }
  });

  it("the bulk action bar offers Sync from name for selected rows", () => {
    const onSync = vi.fn();
    render(<BulkActionBar count={3} onTag={() => {}} onExport={() => {}} onAddToReport={() => {}} onClear={() => {}} onSyncFromName={onSync} />);
    fireEvent.click(screen.getByRole("button", { name: /Sync from name/ }));
    expect(onSync).toHaveBeenCalled();
  });
});
