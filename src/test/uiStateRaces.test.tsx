/**
 * Regression tests for state that leaked or raced when the client or engagement changed, and for
 * one-tap double submits:
 *
 * - Deliverables: a slow response for the engagement left behind is ignored, and a failed load shows
 *   the error instead of "no deliverables".
 * - Handoffs: the packet brief does not carry over to another engagement, and a load error clears
 *   once a later load works.
 * - Learning: an observed week needs a typed count (no default zero).
 * - Public links: a response for the previous link token is ignored.
 * - Ingest tokens: a second click on Create makes one token, and a new token is not replaced.
 * - Recommendations: newest() breaks a tie on the version by timestamp.
 * - useRealBuilder: a builder previewing another role is not a real builder.
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WithClient } from "./clientSelection";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const h = vi.hoisted(() => ({
  query: (_table: string, _filters: Record<string, unknown>): Promise<Result> => Promise.resolve({ data: [], error: null }),
  rpc: (_name: string, _args: Record<string, unknown>): Promise<Result> => Promise.resolve({ data: null, error: null }),
  publicLink: (_req: Record<string, unknown>): Promise<unknown> => Promise.resolve({ ok: false, reason: "error" }),
  auth: { user: { id: "u1" }, isBuilder: false, isClient: false, isEmployee: true, role: "employee" } as Record<string, unknown>,
  preview: { isClientPreview: false, isEmployeePreview: false },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => h.rpc(name, args ?? {}),
    from: (table: string) => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const q = {
          eq: (c: string, v: unknown) => { filters[c] = v; return q; },
          order: () => q,
          limit: () => q,
          in: () => q,
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => h.query(table, filters).then(ok, bad),
        };
        return q;
      },
    }),
  },
}));
vi.mock("@/features/public-links/publicLinkApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/public-links/publicLinkApi")>()),
  callPublicLink: (req: Record<string, unknown>) => h.publicLink(req),
}));

import DeliverablesPage from "@/features/deliverables/DeliverablesPage";
import HandoffsPage from "@/features/handoffs/HandoffsPage";
import LearningPage from "@/features/learning/LearningPage";
import PublicLocationBoardPage from "@/features/public-links/PublicLocationBoardPage";
import { IngestTokensSection } from "@/features/integration-health/IngestTokensSection";
import { newest } from "@/features/recommendations/model";
import { useRealBuilder } from "@/hooks/useRealBuilder";

const CLIENTS = [{ slug: "glow", name: "Glow Drip", active: true }];
const ENGAGEMENTS = [{ id: "e1", cycle_number: 1, status: "active" }, { id: "e2", cycle_number: 2, status: "active" }];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const deliverable = (id: string, engagement: string, title: string) => ({
  id, engagement_id: engagement, title, asset_kind: "video", agreed_item: null, current_revision: 1, stage: "client_review", final_download_url: null,
  engagement_deliverable_revisions: [{ revision: 1, review_url: "https://air.inc/r/1", air_revision_id: null, note: null, created_by: "u1", created_at: "2026-11-03T00:00:00Z" }],
  engagement_deliverable_decisions: [],
  engagement_deliverable_round_exceptions: [],
});

beforeEach(() => {
  h.query = () => Promise.resolve({ data: [], error: null });
  h.rpc = () => Promise.resolve({ data: null, error: null });
  h.auth = { user: { id: "u1" }, isBuilder: false, isClient: false, isEmployee: true, role: "employee" };
  h.preview = { isClientPreview: false, isEmployeePreview: false };
});

describe("DeliverablesPage races and errors", () => {
  it("ignores a slow response for the engagement the user already left", async () => {
    const slow = deferred<Result>();
    const fast = deferred<Result>();
    h.query = (table, f) => {
      if (table === "engagements") return Promise.resolve({ data: ENGAGEMENTS, error: null });
      if (table === "engagement_deliverables") return f.engagement_id === "e1" ? slow.promise : fast.promise;
      return Promise.resolve({ data: [], error: null });
    };
    render(<WithClient slug="glow" clients={CLIENTS}><DeliverablesPage /></WithClient>);
    await screen.findByRole("option", { name: /Cycle 1/ });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e2" } });
    await act(async () => { fast.resolve({ data: [deliverable("d2", "e2", "Second cycle video")], error: null }); });
    await screen.findByRole("region", { name: "Second cycle video" });
    await act(async () => { slow.resolve({ data: [deliverable("d1", "e1", "First cycle video")], error: null }); });
    expect(screen.queryByRole("region", { name: "First cycle video" })).toBeNull();
    expect(screen.getByRole("region", { name: "Second cycle video" })).toBeInTheDocument();
  });

  it("shows the error, not an empty state, when the load fails", async () => {
    h.query = (table) => {
      if (table === "engagements") return Promise.resolve({ data: ENGAGEMENTS, error: null });
      if (table === "engagement_deliverables") return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: [], error: null });
    };
    render(<WithClient slug="glow" clients={CLIENTS}><DeliverablesPage /></WithClient>);
    await screen.findByRole("option", { name: /Cycle 1/ });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
    expect(await screen.findByText("Deliverables could not load.")).toBeInTheDocument();
    expect(screen.queryByText("No deliverables for this engagement yet")).toBeNull();
  });
});

describe("HandoffsPage state", () => {
  it("clears the brief when another engagement is picked", async () => {
    h.query = (table) => Promise.resolve({ data: table === "engagements" ? ENGAGEMENTS : [], error: null });
    render(<WithClient slug="glow" clients={CLIENTS}><HandoffsPage /></WithClient>);
    await screen.findByRole("option", { name: /Cycle 1/ });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
    fireEvent.change(await screen.findByLabelText("Brief"), { target: { value: "Brief for cycle one" } });
    expect(screen.getByLabelText("Brief")).toHaveValue("Brief for cycle one");
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e2" } });
    await waitFor(() => expect(screen.getByLabelText("Brief")).toHaveValue(""));
  });

  it("clears a load error once the next load works, and shows a loading state first", async () => {
    let fail = true;
    const gate = deferred<Result>();
    h.query = (table) => {
      if (table === "engagements") return Promise.resolve({ data: ENGAGEMENTS, error: null });
      if (table === "handoff_packets") return fail ? Promise.resolve({ data: null, error: { message: "down" } }) : gate.promise;
      return Promise.resolve({ data: [], error: null });
    };
    render(<WithClient slug="glow" clients={CLIENTS}><HandoffsPage /></WithClient>);
    await screen.findByRole("option", { name: /Cycle 1/ });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
    expect(await screen.findByText("Handoffs could not load.")).toBeInTheDocument();
    fail = false;
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e2" } });
    expect(screen.queryByText("Handoffs could not load.")).toBeNull();
    expect(await screen.findByRole("status", { name: "Loading handoffs" })).toBeInTheDocument();
    await act(async () => { gate.resolve({ data: [], error: null }); });
    expect(await screen.findByText("No handoffs for this engagement yet.")).toBeInTheDocument();
  });
});

describe("LearningPage observed count", () => {
  it("does not record an observed week until a count is typed", async () => {
    const calls: string[] = [];
    h.query = (table) => Promise.resolve({ data: table === "engagements" ? ENGAGEMENTS : [], error: null });
    h.rpc = (name) => { calls.push(name); return Promise.resolve({ data: 1, error: null }); };
    render(<WithClient slug="glow" clients={CLIENTS}><LearningPage /></WithClient>);
    fireEvent.click(screen.getByRole("button", { name: "Self-service" }));
    await screen.findByRole("option", { name: /Cycle 1/ });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
    fireEvent.change(await screen.findByLabelText("Week"), { target: { value: "2026-11-10" } });
    const record = screen.getByRole("button", { name: /Record week of/ });
    expect(screen.getByLabelText("Questions")).toHaveValue(null);
    expect(record).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Questions"), { target: { value: "0" } });
    expect(record).toBeEnabled();
    fireEvent.click(record);
    await waitFor(() => expect(calls).toContain("record_learning_support_week"));
  });
});

describe("public link token change", () => {
  it("ignores the response for the previous link", async () => {
    const first = deferred<unknown>();
    h.publicLink = (req) => (req.token === "aaa" ? first.promise : Promise.resolve({ ok: true, data: { label: "Second link", client_name: "B", locations: [] } }));
    const Probe = () => (
      <Routes>
        <Route path="/l/:token" element={<PublicLocationBoardPage />} />
      </Routes>
    );
    const { rerender } = render(<MemoryRouter key="a" initialEntries={["/l/aaa"]}><Probe /></MemoryRouter>);
    rerender(<MemoryRouter key="b" initialEntries={["/l/bbb"]}><Probe /></MemoryRouter>);
    expect(await screen.findByText("Second link")).toBeInTheDocument();
    await act(async () => { first.resolve({ ok: true, data: { label: "First link", client_name: "A", locations: [] } }); });
    expect(screen.queryByText("First link")).toBeNull();
    expect(screen.getByText("Second link")).toBeInTheDocument();
  });
});

describe("IngestTokensSection double submit", () => {
  it("makes one token on a double click and keeps the first raw token on screen", async () => {
    const created: string[] = [];
    const gate = deferred<Result>();
    h.rpc = (name) => {
      if (name === "list_ingest_tokens") return Promise.resolve({ data: [], error: null });
      if (name === "list_ingest_audit") return Promise.resolve({ data: [], error: null });
      if (name === "create_ingest_token") { created.push(name); return gate.promise; }
      return Promise.resolve({ data: null, error: null });
    };
    render(<IngestTokensSection isBuilder environment="staging" />);
    fireEvent.change(await screen.findByLabelText("Token name"), { target: { value: "hq-processes" } });
    const create = screen.getByRole("button", { name: "Create token" });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(created).toHaveLength(1);
    await act(async () => { gate.resolve({ data: { name: "hq-processes", token: "raw-token-one" }, error: null }); });
    const field = await screen.findByLabelText("New ingest token");
    expect(field).toHaveValue("raw-token-one");
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "second" } });
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
    expect(within(screen.getByTestId("ingest-token-once")).getByLabelText("New ingest token")).toHaveValue("raw-token-one");
  });
});

describe("recommendations newest()", () => {
  it("breaks a tie on the version by evaluated_at, then created_at", () => {
    const a = { id: "a", recommendation_version: 2, evaluated_at: "2026-11-01T10:00:00Z" };
    const b = { id: "b", recommendation_version: 2, evaluated_at: "2026-11-01T12:00:00Z" };
    expect(newest([b, a])?.id).toBe("b");
    expect(newest([a, b])?.id).toBe("b");
    const c = { id: "c", recommendation_version: 3, created_at: "2026-10-01T00:00:00Z" };
    const d = { id: "d", recommendation_version: 3, created_at: "2026-10-02T00:00:00Z" };
    expect(newest([d, c])?.id).toBe("d");
    expect(newest([c, d])?.id).toBe("d");
    expect(newest([a, c])?.id).toBe("c");
    expect(newest([])).toBeUndefined();
  });
});

describe("useRealBuilder", () => {
  it("is false for a builder previewing the client or employee view", () => {
    h.auth = { isBuilder: true };
    expect(renderHook(() => useRealBuilder()).result.current).toBe(true);
    h.preview = { isClientPreview: true, isEmployeePreview: false };
    expect(renderHook(() => useRealBuilder()).result.current).toBe(false);
    h.preview = { isClientPreview: false, isEmployeePreview: true };
    expect(renderHook(() => useRealBuilder()).result.current).toBe(false);
    h.preview = { isClientPreview: false, isEmployeePreview: false };
    h.auth = { isBuilder: false };
    expect(renderHook(() => useRealBuilder()).result.current).toBe(false);
  });
});
