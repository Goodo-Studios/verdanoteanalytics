/**
 * Sync cooldown on Settings (audit plan item 5.9, part 3).
 *
 * The field read its value once, at first render, before settings arrived, and it looked
 * for an array row although GET /settings returns an object. So it always showed "0",
 * even with a value saved, and the server default is 2 minutes. Pressing Save then turned
 * the cooldown off. Now the field shows the saved value (or 2), picks it up when settings
 * arrive without overwriting an edit, and cannot save before settings load.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  settings: undefined as Record<string, string> | undefined,
  saveMutate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isBuilder: true, user: { id: "u1" } }) }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ selectedAccountId: "all", selectedAccount: null, setSelectedAccountId: vi.fn() }),
}));
vi.mock("@/hooks/useAccountsApi", () => {
  const m = () => ({ mutate: vi.fn(), mutateAsync: vi.fn() });
  return {
    useAccounts: () => ({ data: [] }),
    useToggleAccount: m, useRenameAccount: m, useUploadMappings: m, useUpdateAccountSettings: m,
  };
});
vi.mock("@/hooks/useSyncApi", () => ({ useSync: () => ({}), useRefreshMedia: () => ({}) }));
vi.mock("@/hooks/useSettingsApi", () => ({
  useSettings: () => ({ data: h.settings }),
  useSaveSettings: () => ({ mutate: h.saveMutate }),
}));

import { useSettingsPageState } from "@/hooks/useSettingsPageState";

beforeEach(() => {
  h.settings = undefined;
  h.saveMutate.mockReset();
});

describe("sync cooldown setting", () => {
  it("shows the saved value from the settings object", () => {
    h.settings = { sync_cooldown_minutes: "5" };
    const { result } = renderHook(() => useSettingsPageState());
    expect(result.current.syncCooldownMinutes).toBe("5");
  });

  it("shows the 2 minute default when nothing is saved", () => {
    h.settings = {};
    const { result } = renderHook(() => useSettingsPageState());
    expect(result.current.syncCooldownMinutes).toBe("2");
  });

  it("picks up the saved value when settings arrive after the first render", () => {
    const { result, rerender } = renderHook(() => useSettingsPageState());
    h.settings = { sync_cooldown_minutes: "7" };
    rerender();
    expect(result.current.syncCooldownMinutes).toBe("7");
  });

  it("keeps an edit made before settings arrive", () => {
    h.settings = { sync_cooldown_minutes: "7" };
    const { result, rerender } = renderHook(() => useSettingsPageState());
    act(() => result.current.setSyncCooldownMinutes("10"));
    h.settings = { sync_cooldown_minutes: "7" };
    rerender();
    expect(result.current.syncCooldownMinutes).toBe("10");
  });

  it("does not save before settings have loaded", () => {
    const { result } = renderHook(() => useSettingsPageState());
    act(() => result.current.handleSaveCooldown());
    expect(h.saveMutate).not.toHaveBeenCalled();
    expect(result.current.cooldownLoaded).toBe(false);
  });

  it("saves once settings have loaded", () => {
    h.settings = { sync_cooldown_minutes: "3" };
    const { result } = renderHook(() => useSettingsPageState());
    act(() => result.current.handleSaveCooldown());
    expect(h.saveMutate).toHaveBeenCalledWith({ sync_cooldown_minutes: "3" });
  });
});
