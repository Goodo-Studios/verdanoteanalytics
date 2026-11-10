/**
 * Shipments, staff page (consolidation step 5c, port of the old dashboard's
 * /shipments package tracker).
 *
 * - Two lanes shown apart: creator shipments (creator_assignments) and studio
 *   shipments (studio_shipments); stuck and footage overdue sort first.
 * - Creator deliveries always send the current tracking and notes, so marking
 *   delivered never wipes them.
 * - Studio shipments are added, edited, marked delivered and deleted through
 *   the checked functions.
 * The row rules and functions are in supabase/tests/dashboard_shipments_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatorShipmentSource, StudioShipment } from "@/features/dashboard/shipmentsModel";

const { FakeDashboardError } = vi.hoisted(() => ({
  FakeDashboardError: class extends Error {
    code?: string;
    constructor(e: { code?: string; message: string }) {
      super(e.message);
      this.code = e.code;
    }
  },
}));
const api = {
  loadShipments: vi.fn(),
  saveCreatorDelivery: vi.fn(),
  createStudioShipment: vi.fn(),
  updateStudioShipment: vi.fn(),
  setStudioDelivered: vi.fn(),
  setStudioNotes: vi.fn(),
  deleteStudioShipment: vi.fn(),
};
const loadBrandsAndTeam = vi.fn();
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError, loadBrandsAndTeam: () => loadBrandsAndTeam() }));
vi.mock("@/features/dashboard/shipmentsApi", () => ({
  loadShipments: () => api.loadShipments(),
  saveCreatorDelivery: (...a: unknown[]) => api.saveCreatorDelivery(...a),
  createStudioShipment: (...a: unknown[]) => api.createStudioShipment(...a),
  updateStudioShipment: (...a: unknown[]) => api.updateStudioShipment(...a),
  setStudioDelivered: (...a: unknown[]) => api.setStudioDelivered(...a),
  setStudioNotes: (...a: unknown[]) => api.setStudioNotes(...a),
  deleteStudioShipment: (...a: unknown[]) => api.deleteStudioShipment(...a),
}));

import { answerConfirm } from "@/test/productionConfirm";
import ShipmentsPage from "@/features/dashboard/ShipmentsPage";
import { EMPTY_STUDIO_FORM, filterShipments, formToStudioArgs, fromCreator, fromStudio, isCreatorShipment, shipmentStatus, trackingUrl, DEFAULT_SHIPMENT_FILTERS } from "@/features/dashboard/shipmentsModel";
import { todayValue } from "@/features/dashboard/model";

const TODAY = todayValue(new Date());
const day = (n: number) => todayValue(new Date(Date.now() + n * 86400000));
const creator = (id: string, name: string, extra: Partial<CreatorShipmentSource> = {}): CreatorShipmentSource => ({
  id, creator_id: `cr-${id}`, client_slug: "glow", stage: "product_shipped", tracking_number: null, product_delivered_at: null, delivery_notes: null,
  next_follow_up_at: null, next_follow_up_source: null, dashboard_creators: { name }, ...extra,
});
const studio = (id: string, description: string, extra: Partial<StudioShipment> = {}): StudioShipment => ({
  id, client_slug: "harbor", actor_assignment_id: null, description, carrier: null, tracking_number: null, shipped_at: null, expected_delivery_at: null,
  delivered_at: null, delivery_notes: null, actor_assignments: null, ...extra,
});
const ON_WAY = creator("a1", "Avery Stone", { tracking_number: "1Z1", delivery_notes: "Signature needed" });
const OVERDUE = creator("a2", "Blake Rivers", { product_delivered_at: day(-8), next_follow_up_at: day(-3) });
const NOT_SHIPMENT = creator("a3", "Casey Moreno");
const BOX = studio("s1", "Six candles", { carrier: "UPS", tracking_number: "1ZSTUDIO", expected_delivery_at: day(-1) });

describe("shipments model", () => {
  it("works out the status the old way", () => {
    expect(shipmentStatus(fromCreator(ON_WAY), TODAY)).toBe("in_transit");
    expect(shipmentStatus(fromCreator(OVERDUE), TODAY)).toBe("footage_overdue");
    expect(shipmentStatus(fromStudio(BOX), TODAY)).toBe("stuck");
    expect(shipmentStatus(fromStudio(studio("s2", "x")), TODAY)).toBe("not_shipped");
    expect(shipmentStatus(fromStudio(studio("s3", "x", { delivered_at: TODAY })), TODAY)).toBe("delivered");
    expect(shipmentStatus(fromCreator(creator("a4", "x", { product_delivered_at: TODAY, next_follow_up_at: day(5) })), TODAY)).toBe("footage_due");
  });

  it("counts a creator row as a shipment only once it has tracking, a delivery or notes", () => {
    expect(isCreatorShipment(NOT_SHIPMENT)).toBe(false);
    expect(isCreatorShipment(ON_WAY)).toBe(true);
  });

  it("links tracking to the carrier's public page only for known carriers", () => {
    expect(trackingUrl("UPS", " 1Z 9 ")).toBe("https://www.ups.com/track?loc=en_US&requester=ST&tracknum=1Z%209");
    expect(trackingUrl("Fed-Ex", "77")).toBe("https://www.fedex.com/fedextrack/?trknbr=77");
    expect(trackingUrl("Pigeon", "1")).toBeNull();
    expect(trackingUrl(null, "1")).toBeNull();
  });

  it("keeps lanes apart and sorts the urgent ones first", () => {
    const rows = [fromCreator(ON_WAY), fromCreator(OVERDUE), fromStudio(BOX)];
    const name = (s: string) => s;
    expect(filterShipments(rows, DEFAULT_SHIPMENT_FILTERS, TODAY, name).map((r) => r.sourceId)).toEqual(["a2", "a1"]);
    expect(filterShipments(rows, { ...DEFAULT_SHIPMENT_FILTERS, show: "attention" }, TODAY, name).map((r) => r.sourceId)).toEqual(["a2"]);
    expect(filterShipments(rows, { ...DEFAULT_SHIPMENT_FILTERS, lane: "studio", search: "candle" }, TODAY, name).map((r) => r.sourceId)).toEqual(["s1"]);
  });

  it("checks the studio form before any call", () => {
    expect(() => formToStudioArgs(EMPTY_STUDIO_FORM)).toThrow(/client/);
    expect(() => formToStudioArgs({ ...EMPTY_STUDIO_FORM, client_slug: "harbor" })).toThrow(/what is in/);
    expect(() => formToStudioArgs({ ...EMPTY_STUDIO_FORM, client_slug: "harbor", description: "x".repeat(301) })).toThrow(/300/);
    expect(formToStudioArgs({ ...EMPTY_STUDIO_FORM, client_slug: "harbor", description: " Rug ", carrier: "UPS" })).toEqual({
      p_client_slug: "harbor", p_description: "Rug", p_carrier: "UPS", p_tracking_number: null, p_shipped_at: null, p_expected_delivery_at: null, p_actor_assignment_id: null,
    });
  });
});

describe("Shipments page", () => {
  beforeEach(() => {
    for (const f of [...Object.values(api), loadBrandsAndTeam]) f.mockReset();
    api.loadShipments.mockResolvedValue({ creators: [ON_WAY, OVERDUE, NOT_SHIPMENT], studio: [BOX], shoots: [{ id: "aa1", client_slug: "harbor", scheduled_shoot_date: day(9), actors: { name: "Indigo Reyes" } }] });
    loadBrandsAndTeam.mockResolvedValue({ brands: [{ slug: "glow", name: "Glow Co", active: true, does_creators: true }, { slug: "harbor", name: "Harbor Home", active: true, does_creators: false }], users: [] });
    for (const f of Object.values(api)) if (f !== api.loadShipments) f.mockResolvedValue(undefined);
  });

  const renderPage = () => render(<MemoryRouter><ShipmentsPage /></MemoryRouter>);

  it("shows creator shipments with the overdue one first and links to the creator", async () => {
    renderPage();
    const overdue = await screen.findByTestId("shipment-creators:a2");
    expect(within(overdue).getByText("Footage overdue")).toBeTruthy();
    expect(within(overdue).getByText("Blake Rivers").getAttribute("href")).toBe("/employee/creators/cr-a2");
    expect(screen.queryByTestId("shipment-creators:a3")).toBeNull();
    expect(screen.getAllByRole("row")[1].getAttribute("data-testid")).toBe("shipment-creators:a2");
    expect(screen.getByRole("tab", { name: /Creator shipments \(1 need attention\)/ })).toBeTruthy();
  });

  it("marks a creator delivered and keeps the tracking and notes", async () => {
    renderPage();
    fireEvent.click(within(await screen.findByTestId("shipment-creators:a1")).getByText("Delivered today"));
    await waitFor(() => expect(api.saveCreatorDelivery).toHaveBeenCalledWith("a1", "1Z1", TODAY, "Signature needed"));
    expect((await screen.findByRole("status")).textContent).toMatch(/Footage is due 5 days after/);
  });

  it("edits notes through a prompt and keeps the delivered date", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(" Box dented ");
    renderPage();
    fireEvent.click(within(await screen.findByTestId("shipment-creators:a2")).getByText("Notes"));
    await waitFor(() => expect(api.saveCreatorDelivery).toHaveBeenCalledWith("a2", null, day(-8), "Box dented"));
  });

  it("shows studio shipments with a carrier link and adds one through the checked function", async () => {
    renderPage();
    await screen.findByTestId("shipment-creators:a1");
    fireEvent.click(screen.getByRole("tab", { name: /Studio shipments/ }));
    const box = screen.getByTestId("shipment-studio:s1");
    expect(within(box).getByText("Stuck")).toBeTruthy();
    expect(within(box).getByText("1ZSTUDIO").getAttribute("href")).toMatch(/^https:\/\/www\.ups\.com\/track/);
    fireEvent.click(screen.getByText("Add studio shipment"));
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "harbor" } });
    fireEvent.change(screen.getByLabelText("What is in it"), { target: { value: "Two lamps" } });
    fireEvent.change(screen.getByLabelText("For the shoot"), { target: { value: "aa1" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(api.createStudioShipment).toHaveBeenCalledWith(expect.objectContaining({ p_client_slug: "harbor", p_description: "Two lamps", p_actor_assignment_id: "aa1" })));
  });

  it("marks a studio shipment delivered and deletes one after a confirm", async () => {
    renderPage();
    await screen.findByTestId("shipment-creators:a1");
    fireEvent.click(screen.getByRole("tab", { name: /Studio shipments/ }));
    fireEvent.click(within(screen.getByTestId("shipment-studio:s1")).getByText("Delivered today"));
    await waitFor(() => expect(api.setStudioDelivered).toHaveBeenCalledWith("s1", TODAY));
    fireEvent.click(within(screen.getByTestId("shipment-studio:s1")).getByText("Delete"));
    await answerConfirm("Delete");
    await waitFor(() => expect(api.deleteStudioShipment).toHaveBeenCalledWith("s1"));
  });

  it("shows a refusal in plain words", async () => {
    api.setStudioDelivered.mockRejectedValue(new FakeDashboardError({ code: "42501", message: "Only active staff can change whether a shipment has been delivered." }));
    renderPage();
    await screen.findByTestId("shipment-creators:a1");
    fireEvent.click(screen.getByRole("tab", { name: /Studio shipments/ }));
    fireEvent.click(within(screen.getByTestId("shipment-studio:s1")).getByText("Delivered today"));
    expect((await screen.findByRole("alert")).textContent).toBe("You do not have permission to do that.");
  });
});
