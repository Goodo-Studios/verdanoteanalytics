// Goodo naming convention (2026-09-27) — tagging UI.
//  - "Style" is shown as "Creative Type"; tag columns ordered + shown by default
//  - every tag cell is editable, filled or not; hook/product/theme are free text
//  - legacy ad_type "Image"/"Photo" reads as "Static"
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

const mutate = vi.fn();
vi.mock("@/hooks/useCreatives", () => ({
  useUpdateCreative: () => ({ mutate, mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useCachedMedia", () => ({
  useCachedMedia: () => ({ url: "", isLoading: false }),
}));

// Radix Select does not open in jsdom; swap in a native <select> with the same API.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Ctx = { value?: string; onValueChange?: (v: string) => void };
  const SelectCtx = React.createContext<Ctx>({});
  const Select = ({ value, onValueChange, children }: Ctx & { children?: ReactNode }) => (
    <SelectCtx.Provider value={{ value, onValueChange }}>{children}</SelectCtx.Provider>
  );
  const SelectContent = ({ children }: { children?: ReactNode }) => {
    const ctx = React.useContext(SelectCtx);
    return (
      <select value={ctx.value ?? ""} onChange={(e) => ctx.onValueChange?.(e.target.value)}>
        <option value="">(none)</option>
        {children}
      </select>
    );
  };
  const SelectItem = ({ value, children }: { value: string; children?: ReactNode }) => <option value={value}>{children}</option>;
  const Nothing = () => null;
  return {
    Select, SelectContent, SelectItem,
    SelectTrigger: Nothing, SelectValue: Nothing, SelectGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectLabel: Nothing,
  };
});

import { CreativesTable } from "@/components/creatives/CreativesTable";
import {
  TABLE_COLUMNS, HEAD_LABELS, GROUP_BY_OPTIONS, migrateColumnPrefs, loadColumnPrefs,
  COLUMN_VISIBLE_KEY, COLUMN_ORDER_KEY, COLUMN_PREFS_VERSION_KEY, NAMING_TAG_COLUMNS,
} from "@/components/creatives/constants";
import { displayAdType, withDisplayTags, withDisplayTagsAll, TAG_FIELD_LABELS } from "@/lib/tagDisplay";
import { TAG_OPTIONS_MAP } from "@/lib/tagOptions";
import { applyAdvancedFilters } from "@/components/creatives/AdvancedFiltersPanel";

const TAG_KEYS = ["type", "person", "style", "product", "hook", "theme"];

function renderTable(creative: Record<string, unknown>) {
  const onSelect = vi.fn();
  render(
    <CreativesTable
      creatives={[creative]}
      visibleCols={new Set(["creative", ...TAG_KEYS])}
      columnOrder={["creative", ...TAG_KEYS]}
      sort={{ key: "", direction: null }}
      onSort={() => {}}
      onReorder={() => {}}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

const FILLED = {
  ad_id: "ad-1", ad_name: "GS200001_Video_Creator_UGCNative_Blanket_TiredBy3pm_Sleep",
  ad_type: "Video", person: "Creator", style: "UGC Native", product: "Blanket",
  hook: "Tired By 3pm", theme: "Sleep", tag_source: "manual",
};

beforeEach(() => {
  mutate.mockReset();
  localStorage.clear();
});

describe("labels and column order", () => {
  it("shows the style column as 'Creative Type' everywhere in the table config", () => {
    expect(HEAD_LABELS.style).toBe("Creative Type");
    expect(TABLE_COLUMNS.find((c) => c.key === "style")?.label).toBe("Creative Type");
    expect(GROUP_BY_OPTIONS.find((o) => o.value === "style")?.label).toBe("Creative Type");
    expect(TAG_FIELD_LABELS.style).toBe("Creative Type");
    expect(HEAD_LABELS.type).toBe("Ad Type");
  });

  it("orders tag columns Ad Type, Person, Creative Type, Product, Hook, Theme and shows them by default", () => {
    const tagCols = TABLE_COLUMNS.filter((c) => TAG_KEYS.includes(c.key));
    expect(tagCols.map((c) => c.key)).toEqual(TAG_KEYS);
    expect(tagCols.every((c) => c.defaultVisible === true)).toBe(true);
  });

  it("renders a 'Creative Type' header and no 'Style' header", () => {
    renderTable(FILLED);
    expect(screen.getByText("Creative Type")).toBeInTheDocument();
    expect(screen.queryByText("Style")).not.toBeInTheDocument();
  });
});

describe("saved column prefs migration", () => {
  it("adds the tag columns to saved visibility once and keeps the user's other choices", () => {
    const out = migrateColumnPrefs({ visible: ["creative", "spend"], order: null }, 1);
    expect(out.visible).toEqual(["creative", "spend", ...NAMING_TAG_COLUMNS]);
    expect(out.order).toBeNull();
  });

  it("re-sequences tag columns into the new order within their saved slots", () => {
    const out = migrateColumnPrefs(
      { visible: null, order: ["creative", "type", "hook", "spend", "person", "style", "product", "theme"] },
      1,
    );
    expect(out.order).toEqual(["creative", "type", "person", "spend", "style", "product", "hook", "theme"]);
  });

  it("runs once: persists the migration and a version, then leaves later edits alone", () => {
    localStorage.setItem(COLUMN_VISIBLE_KEY, JSON.stringify(["creative"]));
    const first = loadColumnPrefs();
    expect(first.visible).toContain("style");
    expect(localStorage.getItem(COLUMN_PREFS_VERSION_KEY)).toBe("2");
    // User hides Creative Type afterwards — must stick.
    localStorage.setItem(COLUMN_VISIBLE_KEY, JSON.stringify(["creative"]));
    expect(loadColumnPrefs().visible).toEqual(["creative"]);
  });

  it("leaves never-saved prefs null so the new defaults apply", () => {
    const prefs = loadColumnPrefs();
    expect(prefs).toEqual({ visible: null, order: null });
    expect(localStorage.getItem(COLUMN_ORDER_KEY)).toBeNull();
  });
});

describe("editable tag cells", () => {
  it("a filled Creative Type cell is a dropdown and can be changed", () => {
    const { onSelect } = renderTable(FILLED);
    const select = screen.getByDisplayValue("UGC Native");
    fireEvent.change(select, { target: { value: "Lifestyle" } });
    expect(mutate).toHaveBeenCalledWith({ adId: "ad-1", updates: { style: "Lifestyle" } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("filled Ad Type and Person cells are dropdowns with the contract lists", () => {
    renderTable(FILLED);
    expect(screen.getByDisplayValue("Video").tagName).toBe("SELECT");
    expect(screen.getByDisplayValue("Creator").tagName).toBe("SELECT");
    expect(TAG_OPTIONS_MAP.ad_type).toEqual(["Video", "Static", "GIF", "Carousel"]);
    expect(TAG_OPTIONS_MAP.person).toEqual(["Creator", "Customer", "Founder", "Actor", "No Talent"]);
    expect(TAG_OPTIONS_MAP.style).toEqual(["UGC Native", "Studio Clean", "Text Forward", "Lifestyle"]);
  });

  it("hook is free text: a filled hook cell edits inline and saves on Enter", () => {
    const { onSelect } = renderTable(FILLED);
    expect(TAG_OPTIONS_MAP.hook).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /Hook: Tired By 3pm/ }));
    const input = screen.getByLabelText("Edit Hook");
    fireEvent.change(input, { target: { value: "  Sunday Reset Routine " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mutate).toHaveBeenCalledWith({ adId: "ad-1", updates: { hook: "Sunday Reset Routine" } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Escape cancels a free-text edit without saving", () => {
    renderTable(FILLED);
    fireEvent.click(screen.getByRole("button", { name: /Theme: Sleep/ }));
    const input = screen.getByLabelText("Edit Theme");
    fireEvent.change(input, { target: { value: "Other" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Theme: Sleep/ })).toBeInTheDocument();
  });

  it("clearing a free-text value saves null; empty cells are editable too", () => {
    renderTable({ ...FILLED, product: null });
    fireEvent.click(screen.getByRole("button", { name: /Product: untagged/ }));
    fireEvent.change(screen.getByLabelText("Edit Product"), { target: { value: "Weighted Blanket" } });
    fireEvent.blur(screen.getByLabelText("Edit Product"));
    expect(mutate).toHaveBeenCalledWith({ adId: "ad-1", updates: { product: "Weighted Blanket" } });

    mutate.mockReset();
    fireEvent.click(screen.getByRole("button", { name: /Hook: Tired By 3pm/ }));
    fireEvent.change(screen.getByLabelText("Edit Hook"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByLabelText("Edit Hook"), { key: "Enter" });
    expect(mutate).toHaveBeenCalledWith({ adId: "ad-1", updates: { hook: null } });
  });
});

describe("ad_type Image/Photo reads as Static", () => {
  it("displayAdType maps the legacy aliases case-insensitively", () => {
    expect(displayAdType("Image")).toBe("Static");
    expect(displayAdType("photo")).toBe("Static");
    expect(displayAdType("STATIC")).toBe("Static");
    expect(displayAdType("Video")).toBe("Video");
    expect(displayAdType("")).toBeNull();
    expect(displayAdType(null)).toBeNull();
  });

  it("withDisplayTags maps rows without mutating the input", () => {
    const row = { ad_id: "a", ad_type: "Image", hook: "X" };
    const out = withDisplayTags(row);
    expect(out).toEqual({ ad_id: "a", ad_type: "Static", hook: "X" });
    expect(row.ad_type).toBe("Image");
    const same = { ad_id: "b", ad_type: "Video" };
    expect(withDisplayTags(same)).toBe(same);
    expect(withDisplayTagsAll([row, same]).map((r) => r.ad_type)).toEqual(["Static", "Video"]);
  });

  it("an Image row shows Static in the table", () => {
    renderTable({ ...FILLED, ...withDisplayTags({ ad_type: "Image" }) });
    expect(screen.getByDisplayValue("Static")).toBeInTheDocument();
  });
});

describe("free-text commit is single-shot", () => {
  it("Enter followed by blur saves once; Escape followed by blur saves nothing", () => {
    renderTable(FILLED);
    fireEvent.click(screen.getByRole("button", { name: /Hook: Tired By 3pm/ }));
    const input = screen.getByLabelText("Edit Hook");
    fireEvent.change(input, { target: { value: "New Hook" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(mutate).toHaveBeenCalledTimes(1);

    mutate.mockReset();
    fireEvent.click(screen.getByRole("button", { name: /Theme: Sleep/ }));
    const theme = screen.getByLabelText("Edit Theme");
    fireEvent.change(theme, { target: { value: "Changed" } });
    fireEvent.keyDown(theme, { key: "Escape" });
    fireEvent.blur(theme);
    expect(mutate).not.toHaveBeenCalled();
  });
});


describe("advanced filters on free-text hook and Static ad type", () => {
  const rows = [
    { ad_id: "1", ad_type: "Image", hook: "Tired By 3pm" },
    { ad_id: "2", ad_type: "Video", hook: "Sunday Reset" },
  ];
  const run = (cond: Record<string, unknown>) =>
    applyAdvancedFilters(rows, [{ id: "c", operator: "is", value: "", ...cond } as never], new Map(), new Map()).map((r) => r.ad_id);

  it("hook filters by case-insensitive contains on the stored text", () => {
    expect(run({ field: "hook_type", operator: "contains", value: "3PM" })).toEqual(["1"]);
    expect(run({ field: "hook_type", operator: "contains", value: "" })).toEqual(["1", "2"]);
  });

  it("an Image row matches the Static ad type filter", () => {
    expect(run({ field: "format", multiValues: ["Static"] })).toEqual(["1"]);
  });
});
