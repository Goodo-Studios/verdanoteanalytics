/**
 * Creative Library ZIP download (audit plan item 3.2).
 *
 * The page used to call window.open after waiting for the export, which popup blockers stop
 * because it is no longer part of the user's click. The finished export now shows a toast with a
 * Download button; the click on that button opens the file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { announceZipExport } from "@/features/creative-library/zipDownload";

describe("announceZipExport", () => {
  beforeEach(() => {
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it("does not open a window by itself; the toast button does", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    announceZipExport({ download_url: "https://files.example/x.zip", file_count: 3 });
    expect(open).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [message, options] = toast.success.mock.calls[0];
    expect(message).toMatch(/3 files/);
    expect(options.action.label).toBe("Download");
    options.action.onClick();
    expect(open).toHaveBeenCalledWith("https://files.example/x.zip", "_blank", "noopener");
    open.mockRestore();
  });

  it("uses the singular for one file", () => {
    announceZipExport({ download_url: "https://files.example/x.zip", file_count: 1 });
    expect(toast.success.mock.calls[0][0]).toMatch(/1 file\b/);
  });

  it("shows the error when the export produced no file", () => {
    announceZipExport({ error: "nothing archived" });
    expect(toast.error).toHaveBeenCalledWith("nothing archived");
    announceZipExport({});
    expect(toast.error).toHaveBeenLastCalledWith("Export produced no file");
  });

  it("the page uses it and no longer opens a window after the await", () => {
    const page = readFileSync(join(process.cwd(), "src/features/creative-library/CreativeLibraryPage.tsx"), "utf8");
    expect(page).toMatch(/announceZipExport\(/);
    expect(page).not.toMatch(/window\.open\(/);
  });
});
