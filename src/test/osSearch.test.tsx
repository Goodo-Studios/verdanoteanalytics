/**
 * Cmd/Ctrl+K content search (OS-015): the snippet markers become <mark> elements built from text
 * (never HTML), rows group as Pages, Tasks, Clients, the request waits 120 ms, needs two
 * characters, cancels a stale request and never shows an old answer, and the palette lists the
 * groups with the matching line, moves into them with the arrow keys and opens them.
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const h = vi.hoisted(() => ({
  auth: { user: { id: "u1" }, role: "builder", isBuilder: true, isEmployee: false, isClient: false } as Record<string, unknown>,
  fetch: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/lib/osSearchApi", () => ({ fetchOsSearch: h.fetch }));

import { cleanRows, groupResults, MARK_END, MARK_START, parseSnippet, plainSnippet, type OsSearchRow } from "@/lib/osSearch";
import { SEARCH_DEBOUNCE_MS, useOsSearch } from "@/hooks/useOsSearch";
import CommandPalette, { Snippet } from "@/components/CommandPalette";
import { WithClient } from "@/test/clientSelection";

const m = (s: string) => `${MARK_START}${s}${MARK_END}`;

const ROWS: OsSearchRow[] = [
  { kind: "client", id: "glow", title: "Glow Drip", subtitle: "Client", snippet: m("Glow") + " Drip", url_hint: "/clients/glow", rank: 1 },
  { kind: "task", id: "t1", title: "Glow hook edit", subtitle: "Glow Drip · editing", snippet: null, url_hint: "/clients/glow/work", rank: 0.5 },
  { kind: "page", id: "p2", title: "Other page", subtitle: "Handbook", snippet: "low", url_hint: "/knowledge/brain?section=Handbook&page=other", rank: 0.1 },
  {
    kind: "page",
    id: "p1",
    title: "Editing Style Defaults",
    subtitle: "Playbooks",
    snippet: `Text appears, text disappears. No flying in, no ${m("sweeping")} ${m("reveals")}`,
    url_hint: "/knowledge/brain?section=Playbooks&page=editing-style-defaults",
    rank: 0.9,
  },
];

describe("parseSnippet", () => {
  it("splits on the markers", () => {
    expect(parseSnippet(`a ${m("b")} c`)).toEqual([
      { text: "a ", marked: false },
      { text: "b", marked: true },
      { text: " c", marked: false },
    ]);
  });

  it("handles empty input, a missing end marker and a stray end marker", () => {
    expect(parseSnippet(null)).toEqual([]);
    expect(parseSnippet("")).toEqual([]);
    expect(parseSnippet(`x ${MARK_START}y`)).toEqual([
      { text: "x ", marked: false },
      { text: "y", marked: true },
    ]);
    expect(parseSnippet(`x${MARK_END}y`)).toEqual([{ text: "xy", marked: false }]);
    expect(plainSnippet(`no ${m("sweeping")} ${m("reveals")}`)).toBe("no sweeping reveals");
  });

  it("keeps HTML as text: a snippet cannot inject markup", () => {
    const { container } = render(<Snippet text={`<img src=x onerror="alert(1)"> ${m("<b>bold</b>")}`} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("<b>bold</b>");
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});

describe("groupResults and cleanRows", () => {
  it("groups as Pages, Tasks, Clients, best rank first, and leaves out empty groups", () => {
    const groups = groupResults(ROWS);
    expect(groups.map((g) => g.label)).toEqual(["Pages", "Tasks", "Clients"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(groupResults(ROWS.filter((r) => r.kind === "task")).map((g) => g.label)).toEqual(["Tasks"]);
    expect(groupResults([])).toEqual([]);
  });

  it("drops rows of an unknown kind or with an address that is not role-relative", () => {
    const rows = cleanRows([
      ...ROWS,
      { ...ROWS[0], kind: "secret" },
      { ...ROWS[0], url_hint: "https://evil.example/x" },
      null,
      "x",
    ]);
    expect(rows).toHaveLength(ROWS.length);
    expect(cleanRows(null)).toEqual([]);
  });
});

describe("useOsSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.fetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("waits 120 ms and sends nothing under two characters", async () => {
    h.fetch.mockResolvedValue(ROWS);
    const { result, rerender } = renderHook(({ q }) => useOsSearch(q), { initialProps: { q: "s" } });
    await act(async () => vi.advanceTimersByTime(500));
    expect(h.fetch).not.toHaveBeenCalled();

    rerender({ q: "sw" });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(h.fetch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0][0]).toBe("sw");
    expect(result.current.rows).toHaveLength(ROWS.length);
    expect(result.current.query).toBe("sw");
  });

  it("only sends the last text when typing fast", async () => {
    h.fetch.mockResolvedValue([]);
    const { rerender } = renderHook(({ q }) => useOsSearch(q), { initialProps: { q: "sw" } });
    rerender({ q: "swe" });
    rerender({ q: "swee" });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0][0]).toBe("swee");
  });

  it("cancels the request in flight and ignores its answer when the text changes", async () => {
    let resolveOld: (rows: OsSearchRow[]) => void = () => {};
    h.fetch.mockImplementationOnce(() => new Promise<OsSearchRow[]>((r) => (resolveOld = r)));
    h.fetch.mockImplementationOnce(async () => [ROWS[1]]);
    const { result, rerender } = renderHook(({ q }) => useOsSearch(q), { initialProps: { q: "old" } });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    const oldSignal = h.fetch.mock.calls[0][1] as AbortSignal;
    expect(oldSignal.aborted).toBe(false);

    rerender({ q: "new" });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(result.current.rows.map((r) => r.id)).toEqual(["t1"]);

    // The old answer arrives late and changes nothing.
    await act(async () => resolveOld([ROWS[0]]));
    expect(result.current.rows.map((r) => r.id)).toEqual(["t1"]);
    expect(result.current.query).toBe("new");
  });

  it("clears when the text gets short and reports an error", async () => {
    h.fetch.mockRejectedValueOnce(new Error("boom"));
    const { result, rerender } = renderHook(({ q }) => useOsSearch(q), { initialProps: { q: "boom" } });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(result.current.error).toBe(true);
    rerender({ q: "b" });
    expect(result.current).toMatchObject({ rows: [], error: false, loading: false });
  });
});

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={["/builder/"]}>
      <WithClient slug="" clients={[{ slug: "bloom", name: "Bloom Skincare", active: true }]}>
        <CommandPalette open onOpenChange={() => {}} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </WithClient>
    </MemoryRouter>,
  );
}

describe("palette with search results", () => {
  beforeEach(() => {
    h.fetch.mockReset();
    h.fetch.mockResolvedValue(ROWS);
  });

  it("lists Pages, Tasks and Clients with the matching line under a page", async () => {
    renderPalette();
    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "sweeping reveals" } });
    const groups = await screen.findAllByTestId("command-palette-group");
    expect(groups.map((g) => g.getAttribute("data-kind"))).toEqual(["page", "task", "client"]);
    expect(within(groups[0]).getByText("Pages")).toBeTruthy();
    const first = within(groups[0]).getAllByTestId("command-palette-search-item")[0];
    expect(first.textContent).toContain("Editing Style Defaults");
    const snippet = within(first).getByTestId("command-palette-snippet");
    expect(Array.from(snippet.querySelectorAll("mark")).map((x) => x.textContent)).toEqual(["sweeping", "reveals"]);
    expect(snippet.textContent).toContain("No flying in, no sweeping reveals");
    expect(screen.queryByTestId("command-palette-empty")).toBeNull();
  });

  it("moves into the results with the arrow keys and opens the Brain page with Enter", async () => {
    renderPalette();
    const input = screen.getByTestId("command-palette-input");
    // No jump-to item matches, so the first search result is first.
    fireEvent.change(input, { target: { value: "sweeping reveals" } });
    await screen.findAllByTestId("command-palette-group");
    const items = screen.getAllByTestId("command-palette-search-item");
    expect(items[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByTestId("command-palette-search-item")[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByTestId("command-palette-search-item")[1].id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/builder/knowledge/brain?section=Playbooks&page=editing-style-defaults"),
    );
  });

  it("keeps the jump-to results first and reaches the search results after them", async () => {
    renderPalette();
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "bloom" } });
    await screen.findAllByTestId("command-palette-group");
    expect(screen.getAllByTestId("command-palette-item")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByTestId("command-palette-search-item")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("opens a task on its client's Work tab on click", async () => {
    renderPalette();
    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "hook edit" } });
    const task = (await screen.findAllByTestId("command-palette-search-item")).find((i) => i.getAttribute("data-kind") === "task")!;
    fireEvent.click(task);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/builder/clients/glow/work"));
  });

  it("says so when the search fails, and still shows the jump-to list", async () => {
    h.fetch.mockReset();
    h.fetch.mockRejectedValue(new Error("down"));
    renderPalette();
    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "bloom" } });
    expect((await screen.findByTestId("command-palette-search-error")).textContent).toContain("not working");
    expect(screen.getAllByTestId("command-palette-item")[0].textContent).toContain("Bloom Skincare");
  });
});
