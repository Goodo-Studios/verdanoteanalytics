/**
 * OS-005: Goodo OS name and War Room tokens. Checks the one token file against the War Room
 * values, that the shell reads them, and that the app is called Goodo OS where people see it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoodoOsMark } from "@/components/GoodoOsMark";
import { APP_NAME } from "@/lib/brand";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const tokens = read("src/styles/goodo-os-tokens.css");

describe("Goodo OS tokens", () => {
  it.each([
    ["--gos-bg", "#f9f7f3"],
    ["--gos-card", "#ffffff"],
    ["--gos-ink", "#1e1e1e"],
    ["--gos-mut", "#6b6560"],
    ["--gos-line", "#e9e5de"],
    ["--gos-late", "#c2412b"],
    ["--gos-radius-card", "20px"],
    ["--gos-radius-pill", "999px"],
    ["--gos-ease", "cubic-bezier(0.2, 0.8, 0.2, 1)"],
  ])("%s is %s, as on the War Room page", (name, value) => {
    expect(tokens).toContain(`${name}: ${value};`);
  });

  it("uses Instrument Sans, Instrument Serif and Source Serif 4", () => {
    expect(tokens).toMatch(/--gos-sans: "Instrument Sans"/);
    expect(tokens).toMatch(/--gos-serif: "Instrument Serif"/);
    expect(tokens).toMatch(/--gos-read: "Source Serif 4"/);
    const html = read("index.html");
    expect(html).toContain("family=Instrument+Sans");
    expect(html).toContain("family=Instrument+Serif");
    expect(html).toContain("family=Source+Serif+4");
    expect(html).not.toContain("family=Space+Grotesk");
    expect(read("tailwind.config.ts")).not.toContain("Space Grotesk");
  });

  it("puts text on solid panels instead of the page grid", () => {
    // Bordered, rounded boxes with no fill of their own get the white card fill.
    expect(tokens).toMatch(/#app-scroll-container[\s\S]*\[class~="border"\][\s\S]*:not\(\[class\*="bg-"\]\)\s*\{\s*background-color: var\(--gos-card\);/);
    // Inputs are white with the darker edge so they read against cream.
    expect(tokens).toMatch(/textarea,\s*select,\s*button\[role="combobox"\]\s*\{\s*background-color: var\(--gos-card\);\s*border-color: var\(--gos-edge\);/);
  });

  it("styles long-form prose even though the typography plugin is not installed", () => {
    expect(tokens).toMatch(/\.prose \{\s*font-family: var\(--gos-read\);/);
    expect(tokens).toMatch(/\.prose:not\(\.max-w-none\) \{\s*max-width: 68ch;/);
    expect(tokens).toMatch(/\.prose p,[\s\S]*margin: 0 0 1em;/);
  });

  it("switches motion off when the device asks for reduced motion", () => {
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important/);
  });

  it("is light only and loads after the old stylesheet", () => {
    expect(tokens).toContain("color-scheme: light");
    const main = read("src/main.tsx");
    expect(main.indexOf("./styles/goodo-os-tokens.css")).toBeGreaterThan(main.indexOf("./index.css"));
  });

  it("drives the shared radius, shadow and font settings", () => {
    const tw = read("tailwind.config.ts");
    expect(tw).toContain('card: "var(--gos-radius-card)"');
    expect(tw).toContain('button: "var(--gos-radius-pill)"');
    expect(tw).toContain('input: "var(--gos-radius-pill)"');
    expect(tw).toContain('card: "var(--gos-shadow)"');
    expect(tw).toContain('sans: ["var(--gos-sans)"]');
  });

  it("has no Verdanote green or serif number font left in the shared settings", () => {
    const tw = read("tailwind.config.ts");
    expect(tw).not.toMatch(/#1B7A4E|#22965F|#156B42|#6B9A7E|#E8F5EE/i);
    expect(tw).toContain('data: ["var(--gos-sans)"]');
    expect(tw).not.toContain("Crimson Pro");
  });

  it("lets the page grid show behind the app and gives dropdowns the pill shape", () => {
    expect(read("src/components/AppLayout.tsx")).not.toContain('"flex min-h-screen w-full bg-background"');
    expect(read("src/components/ui/select.tsx")).toContain("rounded-input");
    // Pages that pass their own corner classes still get pills.
    expect(tokens).toMatch(/select,\s*button\[role="combobox"\]\s*\{\s*border-radius: var\(--gos-radius-pill\) !important;/);
  });
});

describe("Goodo OS name", () => {
  it("is the app name", () => {
    expect(APP_NAME).toBe("Goodo OS");
  });

  it("shows in the sidebar mark", () => {
    render(<GoodoOsMark />);
    expect(screen.getByTestId("app-name")).toHaveTextContent("Goodo OS");
  });

  it("is the page title and the install name", () => {
    expect(read("index.html")).toContain("<title>Goodo OS</title>");
    expect(JSON.parse(read("public/manifest.json")).short_name).toBe("Goodo OS");
  });

  it("is on the sign-in page", () => {
    expect(read("src/pages/LoginPage.tsx")).toContain("title={APP_NAME}");
  });
});
