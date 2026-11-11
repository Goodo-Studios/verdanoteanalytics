/**
 * Jump-to palette (Cmd/Ctrl+K). Staff only: it opens on the shortcut and on the top bar button, lists
 * clients by name and the pages of the new menu by tab name, filters as you type, moves with the arrow
 * keys, goes to the page on Enter or click, closes on Escape, hides builder-only tabs from an employee,
 * and is not rendered, and does not listen, for a client login or a builder previewing the client view.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const h = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, preview: { isClientPreview: false, isEmployeePreview: false } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import { CommandPaletteHost } from "@/components/CommandPaletteHost";
import { WithClient } from "@/test/clientSelection";
import { SECTIONS } from "@/lib/sections";
import { isHiddenPage } from "@/lib/hiddenPages";
import { pageItems, searchJump, clientItems } from "@/lib/jumpTo";

const CLIENTS = [
  { slug: "glow", name: "Glow Drip", active: true },
  { slug: "bloom", name: "Bloom Skincare", active: true },
  { slug: "old", name: "Old Brand", active: false },
];

function setRole(role: "builder" | "employee" | "client", opts: { clientPreview?: boolean } = {}) {
  h.auth = { user: { id: "u1" }, role, isBuilder: role === "builder", isEmployee: role === "employee", isClient: role === "client" };
  h.preview = { isClientPreview: !!opts.clientPreview, isEmployeePreview: false };
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function renderHost() {
  return render(
    <MemoryRouter initialEntries={["/builder/"]}>
      <WithClient slug="" clients={CLIENTS}>
        <CommandPaletteHost />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </WithClient>
    </MemoryRouter>,
  );
}

const pressK = (init: KeyboardEventInit = { ctrlKey: true }) => fireEvent.keyDown(window, { key: "k", ...init });
const labels = () => screen.getAllByTestId("command-palette-item").map((i) => i.querySelector("span")?.textContent);

beforeEach(() => setRole("builder"));

describe("opening", () => {
  it.each([
    ["Ctrl+K", { ctrlKey: true }],
    ["Cmd+K", { metaKey: true }],
  ])("opens on %s", async (_n, init) => {
    renderHost();
    expect(screen.queryByTestId("command-palette")).toBeNull();
    pressK(init);
    expect(await screen.findByTestId("command-palette")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId("command-palette-input"));
  });

  it("opens from the hint button in the top bar, and K alone does nothing", async () => {
    renderHost();
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.queryByTestId("command-palette")).toBeNull();
    const button = screen.getByTestId("command-palette-button");
    expect(button.textContent).toMatch(/Jump to/);
    expect(button.textContent).toMatch(/K/);
    fireEvent.click(button);
    expect(await screen.findByTestId("command-palette")).toBeTruthy();
  });

  it("closes on Escape", async () => {
    renderHost();
    pressK();
    await screen.findByTestId("command-palette");
    fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("command-palette")).toBeNull());
  });
});

describe("what it lists", () => {
  it("lists clients by name and every page of the new menu by tab name", async () => {
    renderHost();
    pressK();
    await screen.findByTestId("command-palette");
    const start = labels();
    expect(start).toContain("Glow Drip");
    expect(start).toContain("Home");
    // Typing a tab name finds it under its section.
    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "call sheets" } });
    await waitFor(() => expect(labels()[0]).toBe("Call sheets"));
    expect(screen.getAllByTestId("command-palette-item")[0].textContent).toContain("Production");
  });

  it("has an entry for every tab of every section, plus Home, Work and Clients", () => {
    const items = pageItems(true);
    for (const s of SECTIONS) {
      expect(items.some((i) => i.to === `/${s.id}`), s.id).toBe(true);
      for (const t of s.tabs) {
        // Hidden pages (src/lib/hiddenPages.ts) are not offered, even to a builder.
        const there = items.some((i) => i.to === `/${s.id}/${t.slug}` && i.label === t.label);
        expect(there, `${s.id}/${t.slug}`).toBe(!isHiddenPage(t.page));
      }
    }
    for (const to of ["/", "/work", "/clients"]) expect(items.some((i) => i.to === to), to).toBe(true);
  });

  it("never offers the four hidden pages, and offers Early pages to a builder only", () => {
    const labels = (b: boolean) => pageItems(b).map((i) => i.label);
    for (const hidden of ["Agent evaluations", "Learning", "Recommendations", "Strategy"]) {
      expect(labels(true), hidden).not.toContain(hidden);
      expect(labels(false), hidden).not.toContain(hidden);
    }
    expect(labels(true)).toContain("Early pages");
    expect(labels(false)).not.toContain("Early pages");
  });

  it("matches clients by name, ignoring case, and lists them before pages", () => {
    const items = [...pageItems(true), ...clientItems(CLIENTS)];
    expect(searchJump(items, "SKIN").map((i) => i.label)).toEqual(["Bloom Skincare"]);
    const bloom = searchJump(items, "bl");
    expect(bloom[0].kind).toBe("client");
    expect(searchJump(items, "zzzz")).toEqual([]);
    expect(searchJump(items, "old")[0]).toMatchObject({ label: "Old Brand", hint: "Client (inactive)" });
  });

  it("hides the builder-only tabs from an employee", () => {
    const labelsFor = (b: boolean) => pageItems(b).map((i) => i.label);
    for (const t of ["Matrix", "Operating costs", "Growth Dashboard"]) {
      expect(labelsFor(true)).toContain(t);
      expect(labelsFor(false)).not.toContain(t);
    }
  });

  it("says plainly when nothing matches", async () => {
    renderHost();
    pressK();
    await screen.findByTestId("command-palette");
    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "zzzzqq" } });
    expect((await screen.findByTestId("command-palette-empty")).textContent).toContain("Nothing matches");
  });
});

describe("going somewhere", () => {
  it("opens a client's page with Enter, from the first result", async () => {
    renderHost();
    pressK();
    await screen.findByTestId("command-palette");
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "glow" } });
    await waitFor(() => expect(labels()[0]).toBe("Glow Drip"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/builder/clients/glow"));
    await waitFor(() => expect(screen.queryByTestId("command-palette")).toBeNull());
  });

  it("moves with the arrow keys and opens a page", async () => {
    renderHost();
    pressK();
    await screen.findByTestId("command-palette");
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "production" } });
    await waitFor(() => expect(labels().length).toBeGreaterThan(1));
    const options = screen.getAllByTestId("command-palette-item");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByTestId("command-palette-item")[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByTestId("command-palette-item")[1].id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByTestId("command-palette-item")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("opens a page on click", async () => {
    renderHost();
    pressK();
    await screen.findByTestId("command-palette");
    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "casting" } });
    const item = (await screen.findAllByTestId("command-palette-item"))[0];
    expect(item.textContent).toContain("Casting");
    fireEvent.click(item);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/builder/production/casting"));
  });

  it("opens Work", async () => {
    renderHost();
    pressK();
    await screen.findByTestId("command-palette");
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "work" } });
    await waitFor(() => expect(within(screen.getByRole("listbox")).getAllByRole("option").length).toBeGreaterThan(0));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/builder/work"));
  });
});

describe("role gating", () => {
  it.each([
    ["a client login", "client", {}],
    ["a builder previewing the client view", "builder", { clientPreview: true }],
  ] as const)("is not rendered for %s, and the shortcut does nothing", async (_l, role, opts) => {
    setRole(role, opts);
    renderHost();
    expect(screen.queryByTestId("command-palette-button")).toBeNull();
    pressK();
    pressK({ metaKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("is rendered for an employee", () => {
    setRole("employee");
    renderHost();
    expect(screen.getByTestId("command-palette-button")).toBeTruthy();
  });
});
