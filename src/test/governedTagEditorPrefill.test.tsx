/**
 * Creative Library tag editor must not wipe Theme/Persona (audit plan item 5.1).
 *
 * The page opened GovernedTagEditor without the creative's current angle_id,
 * so the field started at "Untagged" and Save wrote angle_id = null. Saving
 * without touching the field erased the creative's Theme/Persona. The editor
 * now reads the current value by ad_id, keeps Save disabled until that read
 * finishes, and skips the write when nothing changed.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Profiler } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const updates: Record<string, unknown>[] = [];
let readResult: Promise<{ data: { angle_id: string | null } | null; error: null }>;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      builder.select = vi.fn(() => builder);
      builder.update = vi.fn((p: Record<string, unknown>) => {
        patch = p;
        return builder;
      });
      builder.eq = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(() => readResult);
      builder.single = vi.fn(() => readResult);
      builder.then = (resolve: (v: unknown) => void) => {
        if (patch) updates.push(patch);
        return resolve({ data: null, error: null });
      };
      return builder;
    }),
  },
}));
vi.mock("@/features/creative-library/hooks/useAccountTaxonomy", () => ({
  useAccountTaxonomy: () => ({
    options: { themes: [{ value: "ang-1", label: "Busy parents" }] },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { GovernedTagEditor } from "@/features/creative-library/components/GovernedTagEditor";

function renderEditor(onSaved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <GovernedTagEditor adId="ad-1" accountId="act_1" hook="Did you know" onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
}

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  readResult = Promise.resolve({ data: { angle_id: "ang-1" }, error: null });
});

describe("GovernedTagEditor prefill", () => {
  it("keeps Save disabled until the creative's current Theme/Persona has loaded", async () => {
    let finish: (v: { data: { angle_id: string | null }; error: null }) => void = () => {};
    readResult = new Promise((r) => {
      finish = r;
    });
    renderEditor();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    finish({ data: { angle_id: "ang-1" }, error: null });
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
  });

  it("saving without a change leaves the creative's Theme/Persona alone", async () => {
    const onSaved = renderEditor();
    const save = screen.getByRole("button", { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updates).toEqual([]);
  });

  // The field used to be copied into state by an effect that runs after the render
  // that enables Save. A click in that gap saved "Untagged" and erased the tag; the
  // test above caught it only when its click landed in the gap (flaky in CI). A
  // Profiler callback runs at every commit, before passive effects, so it sees the
  // screen exactly as a user could click it.
  it("never shows Save enabled while the field still reads Untagged", async () => {
    const seen: Array<{ enabled: boolean; field: string }> = [];
    const onCommit = () => {
      const button = screen.queryByRole("button", { name: /save/i }) as HTMLButtonElement | null;
      const field = screen.queryByRole("combobox");
      if (button && field) seen.push({ enabled: !button.disabled, field: field.textContent ?? "" });
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <Profiler id="editor" onRender={onCommit}>
        <QueryClientProvider client={qc}>
          <GovernedTagEditor adId="ad-1" accountId="act_1" hook="Did you know" />
        </QueryClientProvider>
      </Profiler>,
    );
    await waitFor(() => expect(seen.some((c) => c.enabled && c.field.includes("Busy parents"))).toBe(true));
    expect(seen.filter((c) => c.enabled && !c.field.includes("Busy parents"))).toEqual([]);
  });

  it("does not write when the creative is already Untagged and nothing changed", async () => {
    readResult = Promise.resolve({ data: { angle_id: null }, error: null });
    const onSaved = renderEditor();
    const save = screen.getByRole("button", { name: /save/i });
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updates).toEqual([]);
  });
});
