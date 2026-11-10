/**
 * Client Setup tab (phase 4 PR 1): link a client to ad accounts, a ClickUp folder and client logins
 * without a database edit.
 *
 * - The checklist reflects what is linked, and says "never synced" instead of a blank.
 * - Empty, error (not shown as empty) and builders-only states.
 * - Ad accounts: link, unlink after a confirm, a taken account is explained.
 * - ClickUp: pick from the folder list when ClickUp is connected, paste a link or id when it is not
 *   (with a plain note), a folder already linked to another client is refused and named.
 * - Client logins: link by email, the function's plain message is shown, unlink after a confirm.
 * - model rules.
 * The database rules are in supabase/tests/client_setup_test.sql.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

interface Result { data: unknown; error: { code?: string; message: string } | null }
const h = vi.hoisted(() => ({
  isBuilder: true,
  tables: {} as Record<string, { data: unknown; error: { code?: string; message: string } | null }>,
  rpcs: {} as Record<string, { data: unknown; error: { code?: string; message: string } | null }>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  deletes: [] as Array<{ table: string; col: string; val: unknown }>,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  insertResult: { data: null, error: null } as { data: unknown; error: { code?: string; message: string } | null },
  invoke: { data: null, error: null } as { data: unknown; error: unknown },
  invokeCalls: [] as string[],
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: h.isBuilder ? "builder" : "employee", isBuilder: h.isBuilder, isClient: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/contexts/ClientSelectionContext", () => ({
  useClientSelection: () => ({
    selectedSlug: "glow",
    selectedClient: { slug: "glow", name: "Glow Drip", active: true },
    clients: [
      { slug: "glow", name: "Glow Drip", active: true },
      { slug: "harbor", name: "Harbor Home", active: true },
    ],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const q = {
          eq: () => q,
          order: () => q,
          then: (r: (v: unknown) => unknown) => Promise.resolve(h.tables[table] ?? { data: [], error: null }).then(r),
        };
        return q;
      },
      insert: (row: Record<string, unknown>) => {
        h.inserts.push({ table, row });
        return Promise.resolve(h.insertResult);
      },
      delete: () => ({
        eq: (col: string, val: unknown) => {
          h.deletes.push({ table, col, val });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    rpc: (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      return Promise.resolve(h.rpcs[name] ?? { data: [], error: null });
    },
    functions: {
      invoke: (name: string) => {
        h.invokeCalls.push(name);
        return Promise.resolve(h.invoke);
      },
    },
  },
}));

import ClientSetupTab from "@/features/clients/ClientSetupTab";
import {
  buildChecklist,
  checklistSummary,
  folderLabel,
  parseClickUpId,
  setupErrorText,
  syncAgo,
} from "@/features/clients/setupModel";

const ok = (data: unknown): Result => ({ data, error: null });
const STATUS = { client_slug: "glow", ad_account_count: 1, clickup_folder_count: 1, member_count: 1, last_clickup_sync: new Date(Date.now() - 3 * 3_600_000).toISOString() };

function seed(over: { links?: unknown[]; mappings?: unknown[]; members?: unknown[]; status?: unknown } = {}) {
  h.tables = {
    ad_accounts: ok([{ id: "act_glow", name: "Glow Meta" }, { id: "act_free", name: "Free Account" }, { id: "act_harbor", name: "Harbor Meta" }]),
    client_ad_accounts: ok(over.links ?? [{ account_id: "act_glow", client_slug: "glow" }, { account_id: "act_harbor", client_slug: "harbor" }]),
    source_mappings: ok(over.mappings ?? []),
  };
  h.rpcs = {
    list_client_members: ok(over.members ?? []),
    client_setup_status: ok(over.status === undefined ? [STATUS] : over.status),
  };
}

const renderTab = () => render(<MemoryRouter initialEntries={["/builder/clients/glow/setup"]}><ClientSetupTab /></MemoryRouter>);

async function answerDialog(name: "Unlink" | "Cancel", text?: string) {
  const dialog = await screen.findByRole("alertdialog");
  if (text) expect(dialog).toHaveTextContent(text);
  fireEvent.click(within(dialog).getByRole("button", { name }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

beforeEach(() => {
  h.isBuilder = true;
  h.inserts = [];
  h.deletes = [];
  h.rpcCalls = [];
  h.invokeCalls = [];
  h.insertResult = { data: null, error: null };
  h.invoke = { data: { folders: [] }, error: null };
  seed();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("checklist", () => {
  it("shows what is done, and the last ClickUp sync in plain words", async () => {
    seed({ mappings: [{ id: "m1", client_slug: "glow", provider: "clickup", kind: "folder", external_id: "90170123", label: "Glow Folder", active: true }], members: [{ user_id: "u1", email: "pat@glow.test", display_name: "Pat", added_at: "2026-11-01T00:00:00Z" }] });
    renderTab();
    const list = await screen.findByTestId("setup-checklist");
    for (const key of ["ad_account", "clickup", "login", "sync"]) expect(within(list).getByTestId(`setup-check-${key}`).getAttribute("data-done")).toBe("true");
    expect(within(list).getByTestId("setup-check-sync")).toHaveTextContent("3 hours ago");
  });

  it("says nothing is set up, and never synced, for a new client", async () => {
    seed({ links: [], status: [{ ...STATUS, ad_account_count: 0, clickup_folder_count: 0, member_count: 0, last_clickup_sync: null }] });
    renderTab();
    const list = await screen.findByTestId("setup-checklist");
    for (const key of ["ad_account", "clickup", "login", "sync"]) expect(within(list).getByTestId(`setup-check-${key}`).getAttribute("data-done")).toBe("false");
    expect(within(list).getByTestId("setup-check-sync")).toHaveTextContent("Never synced");
    expect(screen.getByTestId("setup-no-accounts")).toHaveTextContent("No ad account is linked to Glow Drip yet.");
    expect(screen.getByTestId("setup-no-mapping")).toHaveTextContent("No ClickUp folder is linked to Glow Drip yet.");
    expect(screen.getByTestId("setup-no-members")).toHaveTextContent("No login is linked to Glow Drip yet.");
  });
});

describe("states", () => {
  it("a failed load says so and does not look like an empty setup", async () => {
    h.rpcs.client_setup_status = { data: null, error: { code: "XX000", message: "down" } };
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not load");
    expect(screen.queryByTestId("setup-checklist")).toBeNull();
    expect(screen.queryByTestId("setup-no-accounts")).toBeNull();
  });

  it("an employee is told only a builder can set a client up and nothing is read", async () => {
    h.isBuilder = false;
    renderTab();
    expect(await screen.findByTestId("client-setup-builders-only")).toHaveTextContent("Only a builder can set up a client");
    expect(h.rpcCalls).toHaveLength(0);
  });
});

describe("ad accounts", () => {
  it("links a free ad account to the client", async () => {
    renderTab();
    const select = await screen.findByLabelText("Ad account to link");
    expect(within(select).queryByRole("option", { name: "Harbor Meta" })).toBeNull();
    fireEvent.change(select, { target: { value: "act_free" } });
    fireEvent.click(screen.getByRole("button", { name: "Link ad account" }));
    await waitFor(() => expect(h.inserts).toEqual([{ table: "client_ad_accounts", row: { account_id: "act_free", client_slug: "glow" } }]));
  });

  it("names the client an ad account is linked to elsewhere", async () => {
    renderTab();
    expect(await screen.findByText(/Linked elsewhere: Harbor Meta \(Harbor Home\)/)).toBeTruthy();
  });

  it("explains a refused link in plain words", async () => {
    h.insertResult = { data: null, error: { code: "23505", message: "duplicate key value" } };
    renderTab();
    fireEvent.change(await screen.findByLabelText("Ad account to link"), { target: { value: "act_free" } });
    fireEvent.click(screen.getByRole("button", { name: "Link ad account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already linked to a client");
  });

  it("unlinks only after a confirm that names the effect", async () => {
    renderTab();
    const button = await screen.findByRole("button", { name: "Unlink Glow Meta" });
    fireEvent.click(button);
    await answerDialog("Cancel", "logins will stop seeing its numbers");
    expect(h.deletes).toHaveLength(0);
    fireEvent.click(button);
    await answerDialog("Unlink", "logins will stop seeing its numbers");
    await waitFor(() => expect(h.deletes).toEqual([{ table: "client_ad_accounts", col: "account_id", val: "act_glow" }]));
  });
});

describe("ClickUp folder", () => {
  it("without ClickUp connected, says so plainly and accepts a pasted folder link", async () => {
    h.invoke = { data: null, error: { context: { status: 503 } } };
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Find folders in ClickUp" }));
    expect(await screen.findByTestId("setup-lookup-note")).toHaveTextContent("ClickUp is not connected here");
    fireEvent.change(screen.getByLabelText("ClickUp folder link or id"), { target: { value: "https://app.clickup.com/9014/v/o/f/90170123456" } });
    fireEvent.change(screen.getByLabelText("Name for this link (optional)"), { target: { value: "Glow Folder" } });
    fireEvent.click(screen.getByRole("button", { name: "Link pasted id" }));
    await waitFor(() => expect(h.inserts).toEqual([{
      table: "source_mappings",
      row: { client_slug: "glow", provider: "clickup", kind: "folder", external_id: "90170123456", label: "Glow Folder", active: true },
    }]));
  });

  it("refuses text that is not a ClickUp link or id and writes nothing", async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText("ClickUp folder link or id"), { target: { value: "glow folder please" } });
    fireEvent.click(screen.getByRole("button", { name: "Link pasted id" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not look like a ClickUp folder link or id");
    expect(h.inserts).toHaveLength(0);
  });

  it("with ClickUp connected, lists the folders, disables one that belongs to another client and links the pick", async () => {
    seed({ mappings: [{ id: "m9", client_slug: "harbor", provider: "clickup", kind: "folder", external_id: "222222", label: "Harbor", active: true }] });
    h.invoke = { data: { folders: [{ id: "111111", name: "Glow Folder", lists: [] }, { id: "222222", name: "Harbor Folder", lists: [] }] }, error: null };
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Find folders in ClickUp" }));
    const select = await screen.findByLabelText("ClickUp folder to link");
    expect(within(select).getByRole("option", { name: "Harbor Folder (linked to Harbor Home)" })).toHaveProperty("disabled", true);
    fireEvent.change(select, { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Link folder" }));
    await waitFor(() => expect(h.inserts[0].row).toMatchObject({ external_id: "111111", kind: "folder", label: "Glow Folder", client_slug: "glow" }));
    expect(h.invokeCalls).toEqual(["clickup-folders"]);
  });

  it("names the client that already has a pasted folder", async () => {
    seed({ mappings: [{ id: "m9", client_slug: "harbor", provider: "clickup", kind: "folder", external_id: "222222", label: "Harbor", active: true }] });
    h.insertResult = { data: null, error: { code: "23505", message: "duplicate" } };
    renderTab();
    fireEvent.change(await screen.findByLabelText("ClickUp folder link or id"), { target: { value: "222222" } });
    fireEvent.click(screen.getByRole("button", { name: "Link pasted id" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already linked to Harbor Home");
  });

  it("shows the current link, hides the add form until it is unlinked, and unlinks after a confirm", async () => {
    seed({ mappings: [{ id: "m1", client_slug: "glow", provider: "clickup", kind: "folder", external_id: "90170123", label: "Glow Folder", active: true }] });
    renderTab();
    expect(await screen.findByTestId("setup-mapping")).toHaveTextContent("Folder: Glow Folder (90170123)");
    expect(screen.queryByLabelText("ClickUp folder link or id")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unlink Glow Folder" }));
    await answerDialog("Unlink", "ClickUp board will stop filling");
    await waitFor(() => expect(h.deletes).toEqual([{ table: "source_mappings", col: "id", val: "m1" }]));
  });

  it("says plainly that a saved list link is not used by the board sync", async () => {
    seed({ mappings: [{ id: "m2", client_slug: "glow", provider: "clickup", kind: "list", external_id: "555555", label: null, active: true }] });
    renderTab();
    expect(await screen.findByTestId("setup-mapping")).toHaveTextContent("Saved, but the board sync reads folders only.");
  });
});

describe("client logins", () => {
  it("lists linked logins and links another by email", async () => {
    seed({ members: [{ user_id: "u1", email: "pat@glow.test", display_name: "Pat", added_at: "2026-11-01T00:00:00Z" }] });
    renderTab();
    expect(await screen.findByTestId("setup-member")).toHaveTextContent("Pat pat@glow.test");
    fireEvent.change(screen.getByLabelText("Email of an existing client login"), { target: { value: "sam@glow.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Link login" }));
    await waitFor(() => expect(h.rpcCalls.filter((c) => c.name === "add_client_member")).toEqual([{ name: "add_client_member", args: { p_slug: "glow", p_email: "sam@glow.test" } }]));
  });

  it("shows the function's plain message when the email has no login", async () => {
    renderTab();
    h.rpcs.add_client_member = { data: null, error: { code: "P0002", message: "There is no login with that email yet. Create the login first, then link it here." } };
    fireEvent.change(await screen.findByLabelText("Email of an existing client login"), { target: { value: "nobody@glow.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Link login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There is no login with that email yet.");
  });

  it("unlinks a login only after a confirm that says the login stays", async () => {
    seed({ members: [{ user_id: "u1", email: "pat@glow.test", display_name: null, added_at: "2026-11-01T00:00:00Z" }] });
    renderTab();
    const button = await screen.findByRole("button", { name: "Unlink pat@glow.test" });
    fireEvent.click(button);
    await answerDialog("Cancel", "Their login stays.");
    expect(h.rpcCalls.some((c) => c.name === "remove_client_member")).toBe(false);
    fireEvent.click(button);
    await answerDialog("Unlink", "Their login stays.");
    await waitFor(() => expect(h.rpcCalls.filter((c) => c.name === "remove_client_member")).toEqual([{ name: "remove_client_member", args: { p_slug: "glow", p_user_id: "u1" } }]));
  });
});

describe("setupModel", () => {
  const now = new Date("2026-11-12T12:00:00Z");

  it("parses a bare id and the links ClickUp shows, and nothing else", () => {
    expect(parseClickUpId("90170123456")).toEqual({ id: "90170123456", kind: null });
    expect(parseClickUpId("  90170123456 ")).toEqual({ id: "90170123456", kind: null });
    expect(parseClickUpId("https://app.clickup.com/9014/v/o/f/90170123456")).toEqual({ id: "90170123456", kind: "folder" });
    expect(parseClickUpId("https://app.clickup.com/9014/v/li/901701234567?pr=1")).toEqual({ id: "901701234567", kind: "list" });
    for (const bad of ["", "   ", "glow", "12", "https://example.com/page", "90170 123"]) expect(parseClickUpId(bad), bad).toBeNull();
  });

  it("words the time since the last sync", () => {
    expect(syncAgo(null, now)).toBe("never");
    expect(syncAgo("not a date", now)).toBe("never");
    expect(syncAgo("2026-11-12T11:59:40Z", now)).toBe("just now");
    expect(syncAgo("2026-11-12T11:30:00Z", now)).toBe("30 minutes ago");
    expect(syncAgo("2026-11-12T11:00:00Z", now)).toBe("1 hour ago");
    expect(syncAgo("2026-11-11T09:00:00Z", now)).toBe("yesterday");
    expect(syncAgo("2026-11-09T09:00:00Z", now)).toBe("3 days ago");
    expect(syncAgo("2026-10-01T09:00:00Z", now)).toBe("Oct 1, 2026");
  });

  it("builds the checklist and its summary", () => {
    const items = buildChecklist({ client_slug: "a", ad_account_count: 2, clickup_folder_count: 0, member_count: 1, last_clickup_sync: null }, now);
    expect(items.map((i) => [i.key, i.done])).toEqual([["ad_account", true], ["clickup", false], ["login", true], ["sync", false]]);
    expect(items[0].detail).toBe("2 ad accounts");
    expect(checklistSummary(items)).toBe("2 of 4 set up");
    expect(checklistSummary(buildChecklist(null, now))).toBe("0 of 4 set up");
  });

  it("words database errors plainly and keeps the login functions' own messages", () => {
    expect(setupErrorText({ code: "42501", message: "x" }, "mapping")).toContain("Only a builder");
    expect(setupErrorText({ code: "23505", message: "x" }, "member")).toContain("already linked to this client");
    expect(setupErrorText({ code: "P0002", message: "No login with that email." }, "member")).toBe("No login with that email.");
    expect(setupErrorText({ code: "P0002", message: "raw database text" }, "ad_account")).not.toContain("raw database text");
    expect(setupErrorText(null, "member")).toContain("Try again");
  });

  it("marks a folder that belongs to another client", () => {
    expect(folderLabel({ id: "1", name: "Glow", lists: [] }, undefined)).toBe("Glow");
    expect(folderLabel({ id: "1", name: "Glow", lists: [] }, "Harbor Home")).toBe("Glow (linked to Harbor Home)");
  });
});
