/**
 * The React chunk must name react-dom/client (React 19).
 *
 * vite.config.ts groups React into one "vendor-react" chunk by naming packages. In React 18,
 * react-dom/client required the package's main entry, so naming "react-dom" pulled it all in. In
 * React 19 the client entry no longer goes through the main entry, so without
 * "react-dom/client" in the list, about 627 KB of react-dom source lands in the main chunk, which
 * pushed main.js to 524 KB against its 380 KB limit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const config = readFileSync(path.resolve(process.cwd(), "vite.config.ts"), "utf8");

describe("vite vendor-react chunk", () => {
  it("lists react-dom/client next to react-dom", () => {
    const line = config.split("\n").find((l) => l.includes('"vendor-react"'));
    expect(line).toBeTruthy();
    expect(line).toContain('"react-dom"');
    expect(line).toContain('"react-dom/client"');
  });
});
