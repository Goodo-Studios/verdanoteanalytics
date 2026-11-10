/**
 * Props, staff page (consolidation step 5c, port of the old dashboard's /props).
 *
 * - Search, store, client, outcome and where filters; the total leaves out
 *   client supplied props.
 * - Add and edit through the checked prop functions; quick changes in the row
 *   (at studio, client supplied, outcome) each call their own function.
 * - Delete only after a confirm.
 * The row rules and functions are in supabase/tests/dashboard_props_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prop } from "@/features/dashboard/propsModel";

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
  loadProps: vi.fn(),
  createProp: vi.fn(),
  updateProp: vi.fn(),
  setAtStudio: vi.fn(),
  setClientSupplied: vi.fn(),
  setReturnStatus: vi.fn(),
  deleteProp: vi.fn(),
};
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError }));
vi.mock("@/features/dashboard/propsApi", () => ({
  loadProps: () => api.loadProps(),
  createProp: (...a: unknown[]) => api.createProp(...a),
  updateProp: (...a: unknown[]) => api.updateProp(...a),
  setAtStudio: (...a: unknown[]) => api.setAtStudio(...a),
  setClientSupplied: (...a: unknown[]) => api.setClientSupplied(...a),
  setReturnStatus: (...a: unknown[]) => api.setReturnStatus(...a),
  deleteProp: (...a: unknown[]) => api.deleteProp(...a),
}));

import PropsPage from "@/features/dashboard/PropsPage";
import { DEFAULT_PROP_FILTERS, EMPTY_PROP_FORM, filterProps, formToPropArgs, formatPrice, spentTotal } from "@/features/dashboard/propsModel";

const prop = (id: string, name: string, extra: Partial<Prop> = {}): Prop => ({
  id, name, store: null, price: null, return_status: null, client: null, at_studio: true, client_supplied: false, bin_number: null, notes: null,
  updated_at: "2026-11-01T00:00:00Z", ...extra,
});
const LAMP = prop("p1", "Brass lamp", { store: "Target", price: 40, client: "Harbor", bin_number: "B3" });
const RUG = prop("p2", "Round rug", { store: "IKEA", price: 120, return_status: "Returned", at_studio: false });
const MUG = prop("p3", "Branded mug", { client: "Harbor", client_supplied: true, price: 15 });

describe("props model", () => {
  it("filters and sorts", () => {
    const all = [LAMP, RUG, MUG];
    expect(filterProps(all, DEFAULT_PROP_FILTERS).map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
    expect(filterProps(all, { ...DEFAULT_PROP_FILTERS, search: "b3" }).map((p) => p.id)).toEqual(["p1"]);
    expect(filterProps(all, { ...DEFAULT_PROP_FILTERS, status: "open" }).map((p) => p.id)).toEqual(["p3", "p1"]);
    expect(filterProps(all, { ...DEFAULT_PROP_FILTERS, status: "Returned" }).map((p) => p.id)).toEqual(["p2"]);
    expect(filterProps(all, { ...DEFAULT_PROP_FILTERS, where: "away" }).map((p) => p.id)).toEqual(["p2"]);
    expect(filterProps(all, { ...DEFAULT_PROP_FILTERS, client: "Harbor", store: "Target" }).map((p) => p.id)).toEqual(["p1"]);
  });

  it("totals what was spent, leaving out client supplied props", () => {
    expect(spentTotal([LAMP, RUG, MUG])).toBe(160);
    expect(formatPrice(160)).toBe("$160.00");
    expect(formatPrice(null)).toBe("");
  });

  it("checks the form before any call", () => {
    expect(() => formToPropArgs(EMPTY_PROP_FORM)).toThrow(/name is required/);
    expect(() => formToPropArgs({ ...EMPTY_PROP_FORM, name: "X", price: "-3" })).toThrow(/Price/);
    expect(formToPropArgs({ ...EMPTY_PROP_FORM, name: " Vase ", price: "$12.50", store: " " })).toMatchObject({ p_name: "Vase", p_price: 12.5, p_store: null, p_return_status: null, p_at_studio: true });
  });
});

describe("Props page", () => {
  let confirmReturn = true;
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    api.loadProps.mockResolvedValue([LAMP, RUG, MUG]);
    for (const f of [api.createProp, api.updateProp, api.setAtStudio, api.setClientSupplied, api.setReturnStatus, api.deleteProp]) f.mockResolvedValue(undefined);
    confirmReturn = true;
    vi.spyOn(window, "confirm").mockImplementation(() => confirmReturn);
  });

  it("lists props with price, bin and outcome, and the total spent", async () => {
    render(<PropsPage />);
    const lamp = await screen.findByTestId("prop-row-p1");
    expect(within(lamp).getByText("$40.00")).toBeTruthy();
    expect(within(lamp).getByText("B3")).toBeTruthy();
    expect(screen.getByTestId("props-count").textContent).toBe("3 props · $160.00 spent, not counting client supplied");
    fireEvent.change(screen.getByLabelText("Where"), { target: { value: "away" } });
    expect(screen.getByTestId("props-count").textContent).toBe("1 of 3 props · $120.00 spent, not counting client supplied");
  });

  it("adds a prop and refuses an empty name first", async () => {
    render(<PropsPage />);
    await screen.findByTestId("prop-row-p1");
    fireEvent.click(screen.getByText("Add prop"));
    fireEvent.click(screen.getByText("Save"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/name is required/);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Throw pillow" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "25" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(api.createProp).toHaveBeenCalledWith(expect.objectContaining({ p_name: "Throw pillow", p_price: 25, p_at_studio: true })));
  });

  it("edits a prop with the row's current place and supplier", async () => {
    render(<PropsPage />);
    fireEvent.click(within(await screen.findByTestId("prop-row-p2")).getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Bin"), { target: { value: "C1" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(api.updateProp).toHaveBeenCalledWith("p2", expect.objectContaining({ p_bin_number: "C1", p_return_status: "Returned" }), RUG));
  });

  it("changes place, supplier and outcome from the row", async () => {
    render(<PropsPage />);
    await screen.findByTestId("prop-row-p1");
    fireEvent.click(screen.getByLabelText("Brass lamp at the studio"));
    await waitFor(() => expect(api.setAtStudio).toHaveBeenCalledWith("p1", false));
    expect((await screen.findByRole("status")).textContent).toBe("Brass lamp: not at the studio.");
    fireEvent.click(screen.getByLabelText("Brass lamp client supplied"));
    await waitFor(() => expect(api.setClientSupplied).toHaveBeenCalledWith("p1", true));
    fireEvent.change(screen.getByLabelText("Brass lamp outcome"), { target: { value: "Kept" } });
    await waitFor(() => expect(api.setReturnStatus).toHaveBeenCalledWith("p1", "Kept"));
  });

  it("deletes only after a confirm, and says when the prop is gone", async () => {
    render(<PropsPage />);
    const mug = await screen.findByTestId("prop-row-p3");
    confirmReturn = false;
    fireEvent.click(within(mug).getByText("Delete"));
    expect(api.deleteProp).not.toHaveBeenCalled();
    confirmReturn = true;
    api.deleteProp.mockRejectedValue(new FakeDashboardError({ code: "P0002", message: "Prop not found." }));
    fireEvent.click(within(mug).getByText("Delete"));
    expect((await screen.findByRole("alert")).textContent).toBe("That prop no longer exists.");
  });
});
