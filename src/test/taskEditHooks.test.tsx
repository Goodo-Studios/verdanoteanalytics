/**
 * useUpdateTask refuses any column the task modal may not edit before it reaches the database, and
 * both edit hooks refresh the open task and the lists after a save. Nothing here calls ClickUp.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ writes: [] as unknown[], rpcs: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => {
        h.writes.push(values);
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
    }),
    rpc: (fn: string, args: unknown) => {
      h.rpcs.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import { useSetTaskField, useUpdateTask } from "@/hooks/useTaskEdit";

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, invalidate };
}

beforeEach(() => {
  h.writes = [];
  h.rpcs = [];
});

describe("useUpdateTask", () => {
  it("refuses a column the modal may not edit, without calling the database", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: "t1", values: { status: "complete", client_slug: "x" } })).rejects.toThrow(
        "Cannot edit status, client_slug here",
      );
    });
    expect(h.writes).toEqual([]);
  });

  it("writes an allowed column and refreshes the task detail and the lists", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "t1", values: { priority: "high" } });
    });
    expect(h.writes).toEqual([{ priority: "high" }]);
    await waitFor(() => {
      const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
      expect(keys).toEqual(expect.arrayContaining([JSON.stringify(["my-task-detail", "t1"]), JSON.stringify(["my-tasks"]), JSON.stringify(["task-by-clickup-id"])]));
    });
  });
});

describe("useSetTaskField", () => {
  it("calls os_set_task_field with the task, field and value and refreshes the task detail", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useSetTaskField(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "t1", fieldId: "f1", value: "UGC" });
    });
    expect(h.rpcs).toEqual([{ fn: "os_set_task_field", args: { p_task_id: "t1", p_field_id: "f1", p_value: "UGC" } }]);
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
});
