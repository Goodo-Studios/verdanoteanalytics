// Audit Batch 9 (lint, react-hooks/exhaustive-deps): both presence hooks track their state from
// the channel's subscribe callback. Supabase calls that callback again with SUBSCRIBED after a
// reconnect, and the callback still held the values from when the channel was opened: the page
// the user was on at that moment (usePresence) or "no card hovered" (useCardPresence). After any
// network blip, teammates saw you on your first page, and lost your current card highlight.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

type SubscribeCb = (status: string) => void | Promise<void>;
const fake = vi.hoisted(() => ({
  track: vi.fn(),
  subscribeCb: null as null | ((status: string) => void | Promise<void>),
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: () => channel,
    subscribe: (cb: SubscribeCb) => {
      fake.subscribeCb = cb;
      return channel;
    },
    track: (payload: unknown) => {
      fake.track(payload);
      return Promise.resolve("ok");
    },
    untrack: vi.fn(),
    presenceState: () => ({}),
  };
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-1", email: "pat@example.com" } }),
}));

import { usePresence } from "@/hooks/usePresence";
import { useCardPresence } from "@/hooks/useCardPresence";

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={["/creatives"]}>{children}</MemoryRouter>
);

const lastTracked = () => fake.track.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  fake.track.mockClear();
  fake.subscribeCb = null;
});

describe("presence after a reconnect", () => {
  it("usePresence re-announces the current page, not the page it opened on", async () => {
    const { result } = renderHook(
      () => {
        usePresence("acct-1");
        return useNavigate();
      },
      { wrapper },
    );
    await act(async () => {
      await fake.subscribeCb?.("SUBSCRIBED");
    });
    expect(lastTracked().current_page).toBe("/creatives");

    act(() => result.current("/reports"));
    expect(lastTracked().current_page).toBe("/reports");

    // Network drop and reconnect: Supabase fires SUBSCRIBED again.
    await act(async () => {
      await fake.subscribeCb?.("SUBSCRIBED");
    });
    expect(lastTracked().current_page).toBe("/reports");
  });

  it("useCardPresence re-announces the hovered card", async () => {
    const { result } = renderHook(() => useCardPresence("acct-1"), { wrapper });
    await act(async () => {
      await fake.subscribeCb?.("SUBSCRIBED");
    });
    act(() => result.current.setHoveredCard("ad-42"));
    expect(lastTracked().hovered_ad_id).toBe("ad-42");

    await act(async () => {
      await fake.subscribeCb?.("SUBSCRIBED");
    });
    expect(lastTracked().hovered_ad_id).toBe("ad-42");
  });
});
