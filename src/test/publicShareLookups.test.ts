/**
 * Shared report and brief links load through one-row lookup functions (audit plan item 1.3),
 * so the open "read every shared row" policies can be dropped. Signed-out visitors never read
 * the tables directly; a signed-in visitor falls back to a direct read under row rules.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  session: null as null | { user: { id: string } },
  direct: null as null | Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const c: any = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn(() => c);
    c.maybeSingle = vi.fn(async () => ({ data: h.direct, error: null }));
    c.single = vi.fn(async () => ({ data: h.direct, error: null }));
    return c;
  };
  return {
    supabase: {
      rpc: h.rpc,
      from: h.from.mockImplementation(() => chain()),
      auth: { getSession: vi.fn(async () => ({ data: { session: h.session } })) },
    },
  };
});

import { fetchPublicReport, fetchSharedBrief } from "@/lib/publicShareLookups";

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockClear();
  h.session = null;
  h.direct = null;
});

describe("public share lookups", () => {
  it("a report link uses get_public_report and never reads the table when signed out", async () => {
    h.rpc.mockResolvedValue({ data: [{ id: "r1", report_name: "Q3" }], error: null });
    const r = await fetchPublicReport("r1");
    expect(h.rpc).toHaveBeenCalledWith("get_public_report", { p_id: "r1" });
    expect(r).toMatchObject({ id: "r1", report_name: "Q3" });
    expect(h.from).not.toHaveBeenCalled();
  });

  it("a report that is not public shows as not found to a signed-out visitor", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchPublicReport("r2")).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("a signed-in visitor falls back to a direct read under row rules", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    h.session = { user: { id: "u1" } };
    h.direct = { id: "r3", report_name: "Draft" };
    expect(await fetchPublicReport("r3")).toMatchObject({ id: "r3" });
    expect(h.from).toHaveBeenCalledWith("reports");
  });

  it("a brief link uses get_shared_brief and never reads the table when signed out", async () => {
    h.rpc.mockResolvedValue({ data: [{ id: "b1", name: "Spring" }], error: null });
    const b = await fetchSharedBrief("tok");
    expect(h.rpc).toHaveBeenCalledWith("get_shared_brief", { p_token: "tok" });
    expect(b).toMatchObject({ id: "b1" });
    expect(h.from).not.toHaveBeenCalled();
  });

  it("the public report page and the brief share hook load through the lookups", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/pages/PublicReportPage.tsx", "utf8");
    const hook = readFileSync("src/hooks/useBriefsApi.ts", "utf8");
    expect(page).toMatch(/fetchPublicReport\(/);
    expect(page).not.toMatch(/from\("reports"\)/);
    const shareHook = hook.slice(hook.indexOf("export function useBriefByShareToken"));
    expect(shareHook.slice(0, shareHook.indexOf("\n}\n"))).toMatch(/fetchSharedBrief\(/);
  });

  it("a lookup error is raised, not hidden as not found", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("boom") });
    await expect(fetchSharedBrief("tok")).rejects.toThrow("boom");
  });
});
