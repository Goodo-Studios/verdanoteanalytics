// Audit Batch 9 (lint, react-hooks/exhaustive-deps): the Settings profile effect depended on the
// whole `user` object. AuthContext sets a new user object on every TOKEN_REFRESHED (about hourly)
// and when another tab signs in, so the effect re-ran: it reloaded the profile from the database
// and reset the display name field, throwing away whatever the user was typing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  user: { id: "u-1", email: "pat@example.com" } as { id: string; email: string },
  profileReads: 0,
}));
const { mutation } = vi.hoisted(() => ({
  mutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: h.user, role: "builder", isBuilder: true }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => {
      h.profileReads += 1;
      return { data: { display_name: "Stored Name" }, error: null };
    },
  };
  return { supabase: { from: () => query } };
});

vi.mock("@/hooks/useSettingsApi", () => ({
  useSettings: () => ({ data: undefined }),
  useTestMeta: mutation,
  useSaveSettings: mutation,
}));
vi.mock("@/hooks/useAccountsApi", () => ({
  useAccounts: () => ({ data: [] }),
  useAddAccount: mutation,
  useDeleteAccount: mutation,
  useRenameAccount: mutation,
}));
vi.mock("@/hooks/useSyncApi", () => ({ useSync: mutation, useRefreshMedia: mutation }));
vi.mock("@/hooks/useUsersApi", () => ({
  useUsers: () => ({ data: [] }),
  useCreateUser: mutation,
  useDeleteUser: mutation,
  useUpdateUser: mutation,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useUserSettingsPageState } from "@/hooks/useUserSettingsPageState";

beforeEach(() => {
  h.user = { id: "u-1", email: "pat@example.com" };
  h.profileReads = 0;
});

describe("Settings profile survives a token refresh", () => {
  it("keeps the typed display name when the auth user object is replaced", async () => {
    const { result, rerender } = renderHook(() => useUserSettingsPageState());
    await waitFor(() => expect(result.current.displayName).toBe("Stored Name"));
    expect(h.profileReads).toBe(1);

    act(() => result.current.setDisplayName("Typed But Not Saved"));

    // TOKEN_REFRESHED: same user, new object.
    h.user = { id: "u-1", email: "pat@example.com" };
    rerender();
    await act(async () => {});

    expect(result.current.displayName).toBe("Typed But Not Saved");
    expect(h.profileReads).toBe(1);
  });

  it("reloads the profile when a different user signs in", async () => {
    const { result, rerender } = renderHook(() => useUserSettingsPageState());
    await waitFor(() => expect(h.profileReads).toBe(1));

    h.user = { id: "u-2", email: "sam@example.com" };
    rerender();
    await waitFor(() => expect(h.profileReads).toBe(2));
    expect(result.current.email).toBe("sam@example.com");
  });
});
