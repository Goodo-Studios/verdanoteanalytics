/**
 * Save to Vault from the creative detail modal (audit plan item 5.10, part 3).
 *
 * After saving, the modal set "saved" but never learned the new vault item's id or
 * share token, so Add to board and Share stayed disabled until the modal was reopened.
 * The vault state now lives in useCreativeVaultState, which reads the saved item's id
 * and share token right after a save.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({
  row: null as { id: string; share_token: string | null } | null,
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = vi.fn(chain);
    b.eq = vi.fn(chain);
    b.limit = vi.fn(chain);
    b.maybeSingle = vi.fn(() => Promise.resolve({ data: h.row, error: null }));
    return b;
  };
  return { supabase: { from: vi.fn(() => builder()), functions: { invoke: h.invoke } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import("@/hooks/useCreativeVaultState");

beforeEach(() => {
  h.row = null;
  h.invoke.mockReset();
});

describe("Save to Vault enables Add to board and Share", () => {
  it("a new save sets the vault item id and share token without reopening", async () => {
    const { useCreativeVaultState } = await load();
    const { result } = renderHook(() => useCreativeVaultState(true, "ad_1"));
    await waitFor(() => expect(result.current.vaultStatusChecked).toBe(true));
    expect(result.current.vaultItemId).toBeNull();

    h.invoke.mockResolvedValue({ data: { ok: true, item_id: "item_9", already_saved: false }, error: null });
    h.row = { id: "item_9", share_token: "tok_9" };
    await act(() => result.current.saveToVault({ ad_id: "ad_1" }));

    expect(result.current.savedToVault).toBe(true);
    expect(result.current.vaultItemId).toBe("item_9");
    expect(result.current.vaultShareToken).toBe("tok_9");
  });

  it("an already-saved creative found on open has its id and token", async () => {
    h.row = { id: "item_1", share_token: "tok_1" };
    const { useCreativeVaultState } = await load();
    const { result } = renderHook(() => useCreativeVaultState(true, "ad_1"));
    await waitFor(() => expect(result.current.vaultItemId).toBe("item_1"));
    expect(result.current.vaultShareToken).toBe("tok_1");
    expect(result.current.alreadyInVault).toBe(true);
  });

  it("a failed save leaves nothing enabled", async () => {
    const { useCreativeVaultState } = await load();
    const { result } = renderHook(() => useCreativeVaultState(true, "ad_1"));
    await waitFor(() => expect(result.current.vaultStatusChecked).toBe(true));
    h.invoke.mockResolvedValue({ data: { error: "boom" }, error: null });
    await act(() => result.current.saveToVault({ ad_id: "ad_1" }));
    expect(result.current.savedToVault).toBe(false);
    expect(result.current.vaultItemId).toBeNull();
  });

  it("the modal uses the shared vault state", () => {
    const src = readFileSync(resolve(__dirname, "../components/CreativeDetailModal.tsx"), "utf8");
    expect(src).toContain("useCreativeVaultState(");
  });
});
