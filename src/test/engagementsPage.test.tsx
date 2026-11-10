/**
 * Engagements (consolidation step 4b, port of the Goodo OS EngagementSetup and
 * closeout pages).
 *
 * - Picking a client lists its cycles with dates, milestones and kickoff state.
 * - Creating the next cycle calls create_engagement_from_template with a template
 *   available to that client (all clients or this client, latest version).
 * - The kickoff is offered only for a planned engagement without one; closeouts
 *   save the next version; an active sprint conflict shows its message.
 * - Builders save template versions with the version on screen; employees do not
 *   see the form.
 * - model rules: milestone and deliverable lines, latest templates, expected
 *   version, errorText, toEngagements.
 * The database rules themselves are in supabase/tests/engagement_setup_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const update = vi.fn();
const data: Record<string, unknown[]> = {};
let auth = { user: { id: "emp-1" }, isBuilder: false };

function chain(rows: () => unknown[]) {
  const q = {
    eq: () => q,
    order: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return q;
}

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => ({
      select: () => chain(() => data[table] ?? []),
      update: (values: unknown) => ({ eq: (col: string, val: unknown) => Promise.resolve(update(table, values, col, val) ?? { data: null, error: null }) }),
    }),
  },
}));

import EngagementsPage from "@/features/engagements/EngagementsPage";
import {
  errorText,
  expectedTemplateVersion,
  latestTemplates,
  parseDeliverableLines,
  parseMilestoneLines,
  toEngagements,
  type EngagementTemplate,
} from "@/features/engagements/model";

const tpl = (id: string, key: string, version: number, client: string | null, type = "standard_sprint"): EngagementTemplate => ({
  id, template_key: key, version, client_slug: client, template_type: type as EngagementTemplate["template_type"],
  milestone_template: [], agreed_deliverables: [], source_reference: "SOW", created_at: "2026-11-01T00:00:00Z",
});
const TEMPLATES = [tpl("t1", "sprint", 1, null), tpl("t2", "sprint", 2, null), tpl("t3", "sprint", 1, "glow"), tpl("t4", "sprint", 1, "other")];
const ACTIVE = {
  id: "e1", client_slug: "glow", cycle_number: 1, engagement_type: "standard_sprint", status: "active",
  start_date: "2026-11-02", day30_date: "2026-12-01", day45_date: "2026-12-16",
  engagement_terms: { template_id: "t1", agreed_deliverables: [], kickoff_recorded_at: "2026-11-02T10:00:00Z" },
  engagement_notes: { purchase_reference: "PO-1" },
  engagement_milestones: [
    { milestone_key: "delivery", position: 2, required_evidence: ["strategist_congruency", "qa_release", "delivery_receipt"], client_visible: true },
    { milestone_key: "kickoff", position: 1, required_evidence: ["source_handoff"], client_visible: false },
  ],
  engagement_closeouts: [],
};
const PLANNED = { ...ACTIVE, id: "e2", cycle_number: 2, status: "planned", start_date: null, day30_date: null, day45_date: null, engagement_terms: { template_id: "t2", agreed_deliverables: [], kickoff_recorded_at: null }, engagement_notes: [], engagement_milestones: [] };

beforeEach(() => {
  rpc.mockReset();
  update.mockReset();
  data.clients = [{ slug: "glow", name: "Glow Drip", active: true }, { slug: "old", name: "Old Co", active: false }];
  data.engagements = [ACTIVE, PLANNED];
  data.engagement_templates = TEMPLATES;
  auth = { user: { id: "emp-1" }, isBuilder: false };
});

async function pick(slug = "glow") {
  render(<EngagementsPage />);
  await screen.findByRole("option", { name: "Glow Drip" });
  fireEvent.change(screen.getByLabelText("Client"), { target: { value: slug } });
}

describe("EngagementsPage", () => {
  it("lists a client's cycles with dates, fixed kickoff and milestones in order", async () => {
    await pick();
    const active = await screen.findByRole("region", { name: "Cycle 1" });
    expect(within(active).getByTestId("dates-e1")).toHaveTextContent("Day 1 2026-11-02 · Day 30 2026-12-01 · Day 45 2026-12-16 · kickoff recorded, dates fixed · purchase PO-1");
    expect(within(active).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "kickoff: source_handoff (internal)", "delivery: strategist_congruency, qa_release, delivery_receipt",
    ]);
    expect(within(active).queryByLabelText("Kickoff date")).toBeNull();
    expect(screen.queryByText(/Save a template version/)).toBeNull(); // employees do not save templates
  });

  it("creates the next cycle from a template available to this client", async () => {
    rpc.mockResolvedValue({ data: "e3", error: null });
    await pick();
    const select = await screen.findByLabelText("Template");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Select a template", "sprint v2 · 45-day sprint · all clients", "sprint v1 · 45-day sprint · this client"]);
    fireEvent.change(select, { target: { value: "t2" } });
    fireEvent.change(screen.getByLabelText("Purchase reference"), { target: { value: " PO-2 " } });
    fireEvent.click(screen.getByRole("button", { name: "Create next cycle" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_engagement_from_template", { p_client_slug: "glow", p_template_id: "t2", p_purchase_reference: "PO-2" }));
  });

  it("offers no new cycle for an inactive client", async () => {
    await pick("old");
    await screen.findByRole("region", { name: "Cycle 1" });
    expect(screen.queryByRole("button", { name: "Create next cycle" })).toBeNull();
  });

  it("records a kickoff once and explains an active sprint conflict", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "dup" } });
    await pick();
    const planned = await screen.findByRole("region", { name: "Cycle 2" });
    const button = within(planned).getByRole("button", { name: "Record kickoff" });
    expect(button).toBeDisabled();
    fireEvent.change(within(planned).getByLabelText("Kickoff date"), { target: { value: "2026-12-17" } });
    fireEvent.click(button);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_engagement_kickoff", { p_engagement_id: "e2", p_start_date: "2026-12-17" }));
    expect(await within(planned).findByRole("alert")).toHaveTextContent("already has an active 45-day sprint");
  });

  it("saves the next closeout version and closes an active cycle", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    await pick();
    const active = await screen.findByRole("region", { name: "Cycle 1" });
    fireEvent.change(within(active).getByLabelText("Evidence limit"), { target: { value: "Two weeks only" } });
    fireEvent.change(within(active).getByLabelText("Testing started"), { target: { value: "2026-11-10" } });
    fireEvent.change(within(active).getByLabelText("Delivered assets"), { target: { value: "12 videos\n\n4 statics" } });
    fireEvent.click(within(active).getByRole("button", { name: "Save closeout version 1" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_engagement_closeout", expect.objectContaining({
      p_engagement_id: "e1", p_expected_version: 0, p_evidence_limit: "Two weeks only", p_testing_started_at: "2026-11-10T00:00:00Z",
      p_testing_ended_at: null, p_delivered_assets: ["12 videos", "4 statics"],
    })));
    fireEvent.click(within(active).getByRole("button", { name: "Mark closed" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("engagements", { status: "closed" }, "id", "e1"));
  });

  it("a builder saves a template version with the version on screen", async () => {
    auth = { user: { id: "b1" }, isBuilder: true };
    rpc.mockResolvedValue({ data: "t5", error: null });
    await pick();
    fireEvent.click(screen.getByText(/Save a template version/));
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "sprint" } });
    fireEvent.change(screen.getByLabelText("Milestones"), { target: { value: "kickoff\nreview | strategist_signoff | internal\ndelivery" } });
    fireEvent.change(screen.getByLabelText("Agreed deliverables"), { target: { value: "Video ads | 12 | 2" } });
    fireEvent.change(screen.getByLabelText("Template source reference"), { target: { value: "SOW 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as version 3" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_engagement_template", {
      p_template_key: "sprint", p_client_slug: null, p_expected_version: 2, p_template_type: "standard_sprint",
      p_milestone_template: ["kickoff", { key: "review", requiredEvidence: ["strategist_signoff"], clientVisible: false }, "delivery"],
      p_agreed_deliverables: [{ name: "Video ads", quantity: 12, clientRevisionRounds: 2 }], p_source_reference: "SOW 2026",
    }));
  });

  it("a builder sees a milestone mistake before anything is sent", async () => {
    auth = { user: { id: "b1" }, isBuilder: true };
    await pick();
    fireEvent.click(screen.getByText(/Save a template version/));
    fireEvent.change(screen.getByLabelText("Milestones"), { target: { value: "delivery | qa_release | client" } });
    fireEvent.change(screen.getByLabelText("Template source reference"), { target: { value: "SOW" } });
    fireEvent.click(screen.getByRole("button", { name: /Save as version/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("delivery milestone keeps");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("model", () => {
  it("parses milestone lines", () => {
    expect(parseMilestoneLines("kickoff\n delivery ")).toEqual({ ok: true, value: ["kickoff", "delivery"] });
    expect(parseMilestoneLines("brief | a, b | client")).toEqual({ ok: true, value: [{ key: "brief", requiredEvidence: ["a", "b"], clientVisible: true }] });
    expect(parseMilestoneLines("").ok).toBe(false);
    expect(parseMilestoneLines("a\na").ok).toBe(false);
    expect(parseMilestoneLines("brief | a, a | client").ok).toBe(false);
    expect(parseMilestoneLines("brief | a | public").ok).toBe(false);
    expect(parseMilestoneLines("Brief").ok).toBe(false);
  });

  it("parses deliverable lines", () => {
    expect(parseDeliverableLines("Videos | 12 | 2\nStatics")).toEqual({ ok: true, value: [{ name: "Videos", quantity: 12, clientRevisionRounds: 2 }, { name: "Statics" }] });
    expect(parseDeliverableLines("Videos | twelve").ok).toBe(false);
    expect(parseDeliverableLines("Videos | 1 | 2 | 3").ok).toBe(false);
    expect(parseDeliverableLines("")).toEqual({ ok: true, value: [] });
  });

  it("latest templates per key and scope, and the expected version", () => {
    expect(latestTemplates(TEMPLATES, "glow").map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(latestTemplates(TEMPLATES, null).map((t) => t.id)).toEqual(["t2"]);
    expect(expectedTemplateVersion(TEMPLATES, "sprint", null)).toBe(2);
    expect(expectedTemplateVersion(TEMPLATES, "sprint", "glow")).toBe(1);
    expect(expectedTemplateVersion(TEMPLATES, "new", null)).toBe(0);
  });

  it("shapes engagements newest cycle first with sorted milestones", () => {
    const [first, second] = toEngagements([ACTIVE, PLANNED]);
    expect(first.cycle_number).toBe(2);
    expect(second.milestones.map((m) => m.milestone_key)).toEqual(["kickoff", "delivery"]);
    expect(second.purchase_reference).toBe("PO-1");
    expect(first.purchase_reference).toBeNull();
  });

  it("errorText maps database codes", () => {
    expect(errorText("40001", "x")).toMatch(/changed since/);
    expect(errorText("42501", "x")).toMatch(/not allowed/);
    expect(errorText("99999", "fallback")).toBe("fallback");
  });
});
