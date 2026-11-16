// Audit Batch 9 (fixed waits): browser tests slept a fixed 2.5 to 3 seconds for data instead of
// waiting for something on the page. A slow load fails them and a fast one wastes the time.
// Wait for a specific element or response (expect(...).toBeVisible, waitForResponse) instead.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function specFiles(dir: string): string[] {
  const root = path.resolve(process.cwd(), dir);
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) return specFiles(path.join(dir, name));
    return name.endsWith(".ts") ? [path.join(dir, name)] : [];
  });
}

describe("browser tests", () => {
  it("never sleep for a fixed time (waitForTimeout)", () => {
    const offenders = ["e2e", "e2e-staging"].flatMap((dir) =>
      specFiles(dir).flatMap((file) =>
        readFileSync(path.resolve(process.cwd(), file), "utf8")
          .split("\n")
          .map((line, i) => ({ file, line: i + 1, text: line }))
          .filter(({ text }) => /\bwaitForTimeout\s*\(/.test(text))
          .map(({ file, line }) => `${file}:${line}`),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
