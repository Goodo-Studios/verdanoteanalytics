/**
 * Client settings on the Team and settings page (consolidation step 5d, the old dashboard
 * Settings "Active clients" section).
 *
 * - Opens on the clients shown on the Client overview; Hidden and All widen it; search by name or slug.
 * - No Coda wording: a synced client says "Updated by the HQ sync" and is read only.
 * - An employee adds a client by hand (slug suggested from the name) and has no show or edit controls.
 * - A builder shows or hides a client (with a confirm) and edits a hand-made client.
 * - model rules.
 * The database rules are in supabase/tests/dashboard_client_settings_test.sql.
 */
import { acceptConfirm, confirmDialogText } from "./adminConfirm";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auth: { isBuilder: false, role: "employee" } as Record<string, unknown> }));
const rpc = vi.fn();
let clients: unknown[] = [];

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => rpc(name, args),
    from: () => ({
      select: () => {
        const q = { order: () => q, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: clients, error: null }).then(r) };
        return q;
      },
    }),
  },
}));

import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { ClientsSettings } from "@/features/team/ClientsSettings";

const renderWithRouter = (ui: ReactElement) => render(<MemoryRouter initialEntries={["/employee/team"]}>{ui}</MemoryRouter>);
import { filterClients, newClientProblem, originLabel, serviceLinesLabel, suggestClientSlug, type ClientRow } from "@/features/team/clientsModel";

const c = (over: Partial<ClientRow>): ClientRow => ({
  slug: "glow", name: "Glow Drip", active: true, status: "active", origin: "manual", does_creators: true, does_production: false, ...over,
});

beforeEach(() => {
  h.auth = { isBuilder: false, role: "employee" };
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  clients = [
    c({}),
    c({ slug: "harbor", name: "Harbor Home", does_creators: false, does_production: true, origin: "coda" }),
    c({ slug: "old-co", name: "Old Co", active: false }),
  ];
});
afterEach(() => cleanup());

describe("ClientsSettings", () => {
  it("opens on clients shown on the overview, widens to hidden and all, and searches", async () => {
    renderWithRouter(<ClientsSettings builder={false} />);
    const items = await screen.findAllByTestId("client-setting");
    expect(items.map((i) => i.querySelector("a")?.textContent)).toEqual(["Glow Drip", "Harbor Home"]);
    expect(items[0].querySelector("a")?.getAttribute("href")).toBe("/employee/clients/glow");
    expect(items[1]).toHaveTextContent("Production · Updated by the HQ sync · On the Client overview");
    expect(screen.queryByText(/Coda/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Which clients"), { target: { value: "inactive" } });
    expect(screen.getAllByTestId("client-setting").map((i) => i.querySelector("a")?.textContent)).toEqual(["Old Co"]);
    fireEvent.change(screen.getByLabelText("Which clients"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "harb" } });
    expect(screen.getAllByTestId("client-setting").map((i) => i.querySelector("a")?.textContent)).toEqual(["Harbor Home"]);
  });

  it("shows each client's setup checklist, with a Set up link for a builder only", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === "client_setup_status"
        ? { data: [{ client_slug: "glow", ad_account_count: 1, clickup_folder_count: 0, member_count: 2, last_clickup_sync: null }], error: null }
        : { data: {}, error: null }));
    const { unmount } = renderWithRouter(<ClientsSettings builder={false} />);
    const lines = await screen.findAllByTestId("client-setup-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("2 of 4 set up");
    expect(lines[0]).toHaveTextContent("✓ Ad account linked");
    expect(lines[0]).toHaveTextContent("○ ClickUp folder linked");
    expect(within(lines[0]).queryByRole("link", { name: "Set up" })).toBeNull();
    unmount();
    h.auth = { isBuilder: true, role: "builder" };
    renderWithRouter(<ClientsSettings builder />);
    const builderLines = await screen.findAllByTestId("client-setup-line");
    expect(within(builderLines[0]).getByRole("link", { name: "Set up" }).getAttribute("href")).toBe("/builder/clients/glow/setup");
  });

  it("still lists the clients when the setup status cannot load", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === "client_setup_status" ? { data: null, error: { code: "XX000", message: "down" } } : { data: {}, error: null }));
    renderWithRouter(<ClientsSettings builder={false} />);
    expect((await screen.findAllByTestId("client-setting")).length).toBe(2);
    expect(screen.queryByTestId("client-setup-line")).toBeNull();
  });

  it("gives an employee no show, hide or edit controls", async () => {
    renderWithRouter(<ClientsSettings builder={false} />);
    const items = await screen.findAllByTestId("client-setting");
    expect(within(items[0]).queryByRole("button")).toBeNull();
    expect(screen.queryByText("Edit name and service lines")).toBeNull();
  });

  it("lets staff add a client by hand with a suggested slug, and refuses a taken slug before calling", async () => {
    renderWithRouter(<ClientsSettings builder={false} />);
    await screen.findAllByTestId("client-setting");
    const group = screen.getByRole("group", { name: "Add a client" });
    fireEvent.change(within(group).getByLabelText("New client name"), { target: { value: "Glow Drip" } });
    expect(within(group).getByLabelText("New client slug")).toHaveValue("glow-drip");
    fireEvent.change(within(group).getByLabelText("New client slug"), { target: { value: "glow" } });
    expect(within(group).getByText('A client with the slug "glow" already exists.')).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Add client" })).toBeDisabled();
    fireEvent.change(within(group).getByLabelText("New client slug"), { target: { value: "Acme-Foods" } });
    fireEvent.click(within(group).getByLabelText("Production"));
    fireEvent.click(within(group).getByRole("button", { name: "Add client" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("create_client", { p_slug: "acme-foods", p_name: "Glow Drip", p_does_creators: true, p_does_production: true }));
  });

  it("lets a builder hide a client after a confirm and edit a hand-made client; a synced client stays read only", async () => {
    renderWithRouter(<ClientsSettings builder />);
    const items = await screen.findAllByTestId("client-setting");
    fireEvent.click(within(items[0]).getByRole("button", { name: "Hide from overview" }));
    expect(rpc).not.toHaveBeenCalledWith("set_client_active", expect.anything());
    expect(await confirmDialogText()).toContain("Hide Glow Drip from the Client overview?");
    await acceptConfirm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_client_active", { p_slug: "glow", p_active: false }));
    expect(within(items[1]).queryByText("Edit name and service lines")).toBeNull();
    expect(items[1]).toHaveTextContent("come from the client knowledge file through the HQ sync");
    const group = within(items[0]).getByRole("group", { name: "Edit Glow Drip" });
    fireEvent.change(within(group).getByLabelText("Client name"), { target: { value: " Glow Drip Co " } });
    fireEvent.click(within(group).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("update_client", { p_slug: "glow", p_name: "Glow Drip Co", p_does_creators: true, p_does_production: false }));
  });

  it("shows a refusal from the database", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Only admins can change which clients are active." } });
    renderWithRouter(<ClientsSettings builder />);
    const items = await screen.findAllByTestId("client-setting");
    fireEvent.click(within(items[0]).getByRole("button", { name: "Hide from overview" }));
    await acceptConfirm();
    expect(await within(items[0]).findByRole("alert")).toHaveTextContent("Not allowed: Only admins can change which clients are active.");
  });
});

describe("clients model", () => {
  it("suggests a URL-safe slug from a name", () => {
    expect(suggestClientSlug("  Café Olé & Sons!  ")).toBe("cafe-ole-sons");
    expect(suggestClientSlug("x".repeat(70)).length).toBe(64);
  });

  it("checks a new client the way create_client does", () => {
    const base = { name: "Acme", slug: "acme", doesCreators: true, doesProduction: false };
    expect(newClientProblem(base, [])).toBeNull();
    expect(newClientProblem({ ...base, slug: "acme--foods" }, [])).toMatch(/single hyphens/);
    expect(newClientProblem({ ...base, slug: "ACME" }, ["acme"])).toMatch(/already exists/);
    expect(newClientProblem({ ...base, doesCreators: false }, [])).toMatch(/service line/);
    expect(newClientProblem({ ...base, name: " " }, [])).toMatch(/name/);
  });

  it("labels clients without Coda wording and sorts active first", () => {
    expect(originLabel({ origin: "coda" })).toBe("Updated by the HQ sync");
    expect(originLabel({ origin: "manual" })).toBe("Added by hand");
    expect(serviceLinesLabel({ does_creators: true, does_production: true })).toBe("Creators and production");
    expect(filterClients([c({ name: "B", active: false }), c({ name: "A" })], "all", "").map((x) => x.name)).toEqual(["A", "B"]);
  });
});
