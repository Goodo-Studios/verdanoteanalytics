import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { embedFirst, embedRows, normalizeItemEmbeds } from "@/features/vault/embedRows";
import {
  buildIlikeOr,
  ilikePattern,
  mergeIds,
  mergeSearchResults,
  VAULT_FRAMEWORK_SEARCH_COLUMNS,
  VAULT_ITEM_SEARCH_COLUMNS,
} from "@/features/vault/utils/textSearch";
import {
  downloadPathFor,
  downloadVaultItems,
  vaultDownloadMessage,
  type VaultDownloadDeps,
} from "@/features/vault/bulkDownload";

describe("embedRows", () => {
  it("turns an object, an array, null and undefined into a list", () => {
    expect(embedRows({ a: 1 })).toEqual([{ a: 1 }]);
    expect(embedRows([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(embedRows(null)).toEqual([]);
    expect(embedRows(undefined)).toEqual([]);
  });

  it("embedFirst returns the first row or null", () => {
    expect(embedFirst({ a: 1 })).toEqual({ a: 1 });
    expect(embedFirst([{ a: 1 }, { a: 2 }])).toEqual({ a: 1 });
    expect(embedFirst(null)).toBeNull();
    expect(embedFirst([])).toBeNull();
  });

  it("normalizeItemEmbeds fixes only the embeds the row carries", () => {
    const row = normalizeItemEmbeds({
      id: "x",
      inspiration_transcripts: { cleaned_script: "hi" },
      inspiration_frameworks: null,
    });
    expect(row.inspiration_transcripts).toEqual([{ cleaned_script: "hi" }]);
    expect(row.inspiration_frameworks).toEqual([]);
    expect(row.id).toBe("x");
    expect("inspiration_frameworks" in normalizeItemEmbeds({ id: "y" })).toBe(false);
  });
});

describe("vault text search helpers", () => {
  it("wraps the term and neutralises wildcards and filter syntax", () => {
    expect(ilikePattern("  hello world ")).toBe("%hello world%");
    expect(ilikePattern("50%_off")).toBe("%50\\%\\_off%");
    expect(ilikePattern('a,b(c)"d')).toBe("%a b c d%");
  });

  it("builds an or filter across every column", () => {
    const or = buildIlikeOr("hook", ["title", "brand_name"]);
    expect(or).toBe("title.ilike.%hook%,brand_name.ilike.%hook%");
  });

  it("covers the title, brand and other metadata, plus the hook fields", () => {
    for (const col of ["title", "brand_name", "ad_body_text", "industry", "target_audience"]) {
      expect(VAULT_ITEM_SEARCH_COLUMNS).toContain(col);
    }
    for (const col of ["hook_verbal", "hook_text", "hook_visual", "copywriting_framework"]) {
      expect(VAULT_FRAMEWORK_SEARCH_COLUMNS).toContain(col);
    }
  });

  it("merges ids without repeats, keeping first-seen order", () => {
    expect(mergeIds(["a", "b"], null, ["b", "c"], undefined, ["a", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("puts text matches first and drops semantic repeats; a missing list is fine", () => {
    const t = [{ id: "1" }, { id: "2" }];
    const s = [{ id: "2" }, { id: "3" }];
    expect(mergeSearchResults(t, s).map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(mergeSearchResults(t, undefined).map((i) => i.id)).toEqual(["1", "2"]);
    expect(mergeSearchResults(undefined, s).map((i) => i.id)).toEqual(["2", "3"]);
  });
});

describe("bulk download", () => {
  const deps = (signed: { path: string | null; signedUrl: string | null }[]) => {
    const trigger = vi.fn();
    const pause = vi.fn(async () => undefined);
    const sign = vi.fn(async () => signed);
    return { deps: { sign, trigger, pause } as VaultDownloadDeps, trigger, pause, sign };
  };

  it("prefers the file and falls back to the saved still", () => {
    expect(downloadPathFor({ id: "1", file_path: "uploads/u/a.mp4", thumbnail_path: "thumbnails/u/a.jpg" })).toBe("uploads/u/a.mp4");
    expect(downloadPathFor({ id: "2", file_path: null, thumbnail_path: "thumbnails/u/b.jpg" })).toBe("thumbnails/u/b.jpg");
    expect(downloadPathFor({ id: "3" })).toBeNull();
  });

  it("signs once, starts one download per file and pauses between them", async () => {
    const d = deps([
      { path: "uploads/u/a.mp4", signedUrl: "https://s/a" },
      { path: "uploads/u/b.mp4", signedUrl: "https://s/b" },
    ]);
    const result = await downloadVaultItems(
      [
        { id: "1", file_path: "uploads/u/a.mp4" },
        { id: "2", file_path: "uploads/u/b.mp4" },
      ],
      d.deps,
    );
    expect(d.sign).toHaveBeenCalledTimes(1);
    expect(d.sign).toHaveBeenCalledWith(["uploads/u/a.mp4", "uploads/u/b.mp4"]);
    expect(d.trigger.mock.calls.map((c) => c[0])).toEqual(["https://s/a", "https://s/b"]);
    expect(d.pause).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ requested: 2, started: 2, skipped: 0 });
  });

  it("counts items with no file or no signed link as skipped", async () => {
    const d = deps([
      { path: "uploads/u/a.mp4", signedUrl: "https://s/a" },
      { path: "uploads/u/gone.mp4", signedUrl: null },
    ]);
    const result = await downloadVaultItems(
      [{ id: "1", file_path: "uploads/u/a.mp4" }, { id: "2", file_path: "uploads/u/gone.mp4" }, { id: "3" }],
      d.deps,
    );
    expect(result).toEqual({ requested: 3, started: 1, skipped: 2 });
    expect(vaultDownloadMessage(result).ok).toBe(false);
  });

  it("does not sign anything when no item has a file", async () => {
    const d = deps([]);
    const result = await downloadVaultItems([{ id: "1" }], d.deps);
    expect(d.sign).not.toHaveBeenCalled();
    expect(result).toEqual({ requested: 1, started: 0, skipped: 1 });
    expect(vaultDownloadMessage(result)).toEqual({
      ok: false,
      text: "Nothing to download. The selected items have no saved file.",
    });
  });

  it("reports a clean run as ok", () => {
    expect(vaultDownloadMessage({ requested: 1, started: 1, skipped: 0 })).toEqual({ ok: true, text: "Downloading 1 file" });
    expect(vaultDownloadMessage({ requested: 3, started: 3, skipped: 0 }).text).toBe("Downloading 3 files");
  });
});
