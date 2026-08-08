// Regression: "Add to Home Screen only lets me add verdanote.com".
//
// Reported from a real iPhone. /capture/quick-add exists precisely so a
// home-screen icon opens the capture form directly, and it could never do that:
// since iOS 16.4, Safari's Share ▸ Add to Home Screen does NOT bookmark the page
// you are on when the page links a manifest requesting standalone display. It
// reads the manifest and saves a *web app* built from it — so the icon always
// launched `start_url`, which is "/". Only when no such manifest is present does
// Safari fall back to the legacy Apple meta tags, and that fallback bookmarks
// the CURRENT URL while still launching without browser chrome.
//
// The fix is a second HTML document for this one route: same SPA bundle, Apple
// meta tags kept, manifest link removed. Removing the link at runtime is not an
// option — since iOS 15.4 the manifest is fetched at page load, not when the
// share sheet opens.
//
// Everything below is the static contract that makes that true. It is static on
// purpose: the iOS behaviour itself is unobservable from vitest, but every way
// this has broken (manifest link creeping back in, the entry vanishing from the
// build, the rewrite landing after the catch-all, the login round-trip turning
// into a client-side navigation) is not.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { QUICK_ADD_PATH, requiresDocumentNavigation } from "@/pwa/quickAdd";

const repoFile = (relativePath: string) => resolve(process.cwd(), relativePath);

/** The document Vite emits to dist/capture/quick-add.html. */
const QUICK_ADD_HTML_SOURCE = "capture/quick-add.html";

const quickAddHtml = readFileSync(repoFile(QUICK_ADD_HTML_SOURCE), "utf8");
const indexHtml = readFileSync(repoFile("index.html"), "utf8");
const viteConfig = readFileSync(repoFile("vite.config.ts"), "utf8");
const vercelConfig = JSON.parse(readFileSync(repoFile("vercel.json"), "utf8")) as {
  rewrites: Array<{ source: string; destination: string }>;
};
const manifest = JSON.parse(readFileSync(repoFile("public/manifest.json"), "utf8"));

/** Read a PNG's real pixel dimensions out of its IHDR chunk. */
function readPngSize(absolutePath: string): { width: number; height: number } {
  const buffer = readFileSync(absolutePath);
  expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // PNG magic
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * HTML with comments removed. The document explains *why* it must not link the
 * manifest, and that prose mentions the manifest by name — assert against real
 * markup so the explanation cannot fail its own test.
 */
const stripHtmlComments = (source: string) => source.replace(/<!--[\s\S]*?-->/g, "");

const quickAddMarkup = stripHtmlComments(quickAddHtml);

// ---------------------------------------------------------------------------
// The bug itself
// ---------------------------------------------------------------------------

describe("quick-add document: no manifest, so iOS bookmarks this URL", () => {
  it("exists as its own HTML entry", () => {
    expect(existsSync(repoFile(QUICK_ADD_HTML_SOURCE))).toBe(true);
  });

  // THE regression. Put a manifest link back into capture/quick-add.html and
  // this fails — which is the whole point.
  it("links no web app manifest at all", () => {
    expect(quickAddMarkup).not.toMatch(/rel=["']?manifest/i);
    expect(quickAddMarkup).not.toMatch(/manifest\.json/i);
    // Asserted on the raw file as well, comments included: the emitted document
    // is what an operator (or a deploy smoke check) greps, and a commented-out
    // manifest link there reads as a live one.
    expect(quickAddHtml).not.toMatch(/rel=["']?manifest/i);
    expect(quickAddHtml).not.toMatch(/manifest\.json/i);
  });

  it("carries the Apple tags that still launch it standalone", () => {
    expect(quickAddMarkup).toMatch(
      /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/?>/,
    );
    expect(quickAddMarkup).toMatch(
      /<meta[^>]+name="apple-mobile-web-app-status-bar-style"[^>]+content="[^"]+"/,
    );
    // The title Safari puts under the icon. Naming it "Verdanote" would be
    // indistinguishable from the root web app on the home screen.
    const title = quickAddMarkup.match(
      /<meta[^>]+name="apple-mobile-web-app-title"[^>]+content="([^"]+)"/,
    )?.[1];
    expect(title).toBeTruthy();
    expect(title).not.toBe(
      indexHtml.match(/<meta[^>]+name="apple-mobile-web-app-title"[^>]+content="([^"]+)"/)?.[1],
    );
  });

  it("points apple-touch-icon at a real 180x180 PNG, since it is the icon iOS saves", () => {
    const href = quickAddMarkup.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/)?.[1];
    expect(href).toBeTruthy();

    const absolutePath = repoFile(`public${href!}`);
    expect(existsSync(absolutePath)).toBe(true);
    expect(readPngSize(absolutePath)).toEqual({ width: 180, height: 180 });
  });

  it("boots the same SPA bundle, so the router still renders CaptureQuickAdd", () => {
    expect(quickAddMarkup).toMatch(/<script[^>]+type="module"[^>]+src="\/src\/main\.tsx"/);
    expect(quickAddMarkup).toMatch(/<div id="root"><\/div>/);
  });

  it("mirrors index.html's head essentials so the page renders identically", () => {
    expect(quickAddMarkup).toMatch(/<meta charset="UTF-8"/i);
    expect(quickAddMarkup).toMatch(/<meta name="viewport"[^>]+width=device-width/);
    expect(quickAddMarkup).toMatch(/<link rel="icon"[^>]+href="\/favicon\.png"/);
    expect(quickAddMarkup).toMatch(/<link rel="icon"[^>]+href="\/favicon\.ico"/);
    expect(quickAddMarkup).toMatch(/<meta[^>]+name="theme-color"[^>]+content="#1B7A4E"/);
    expect(quickAddMarkup).toContain("fonts.googleapis.com");
  });
});

// ---------------------------------------------------------------------------
// The Android half must survive the fix
// ---------------------------------------------------------------------------

describe("the root document keeps its manifest (Android share sheet)", () => {
  it("still links /manifest.json from index.html", () => {
    expect(indexHtml).toMatch(/<link[^>]+rel="manifest"[^>]+href="\/manifest\.json"/);
  });

  it("still declares the share target the Android flow depends on", () => {
    expect(manifest.share_target?.action).toBe("/capture/share-target");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// Build + serving wiring — drop either half and the document never reaches iOS
// ---------------------------------------------------------------------------

describe("build and serving wiring", () => {
  it("declares the quick-add document as a rollup input", () => {
    expect(viteConfig).toMatch(
      /"capture\/quick-add":\s*path\.resolve\(__dirname,\s*"capture\/quick-add\.html"\)/,
    );
    // The pre-existing entries must survive alongside it.
    expect(viteConfig).toMatch(/index:\s*path\.resolve\(__dirname,\s*"index\.html"\)/);
    expect(viteConfig).toMatch(/sw:\s*path\.resolve\(__dirname,\s*"src\/sw\.ts"\)/);
    expect(viteConfig).toMatch(/chunk\.name === "sw" \? "sw\.js"/);
  });

  it("rewrites /capture/quick-add to that document BEFORE the catch-all", () => {
    const rewrites = vercelConfig.rewrites;
    const quickAddIndex = rewrites.findIndex((rule) => rule.source === QUICK_ADD_PATH);
    const catchAllIndex = rewrites.findIndex((rule) => rule.source === "/(.*)");

    expect(quickAddIndex).toBeGreaterThanOrEqual(0);
    expect(catchAllIndex).toBeGreaterThanOrEqual(0);
    // Vercel takes the first matching rewrite: after the catch-all, this rule
    // is dead and the route falls back to index.html — manifest and all.
    expect(quickAddIndex).toBeLessThan(catchAllIndex);
    expect(rewrites[quickAddIndex].destination).toBe("/capture/quick-add.html");
    expect(rewrites[catchAllIndex].destination).toBe("/index.html");
  });

  it("leaves the Android share-target route on the index.html document", () => {
    const overrides = vercelConfig.rewrites.filter(
      (rule) => rule.source !== "/(.*)" && rule.source === manifest.share_target.action,
    );
    expect(overrides).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The login round-trip — a client-side return lands on index.html and the bug
// is back, with no visible symptom until someone opens the share sheet.
// ---------------------------------------------------------------------------

describe("requiresDocumentNavigation", () => {
  it("is true for the quick-add path, which has its own document", () => {
    expect(requiresDocumentNavigation(QUICK_ADD_PATH)).toBe(true);
    expect(requiresDocumentNavigation(`${QUICK_ADD_PATH}?ref=icon`)).toBe(true);
    expect(requiresDocumentNavigation(`${QUICK_ADD_PATH}#top`)).toBe(true);
  });

  it("is false everywhere else, so the rest of the app keeps SPA navigation", () => {
    for (const path of [
      "/",
      "/vault",
      "/capture/share-target?url=https%3A%2F%2Fexample.com",
      "/capture/quick-add-extra",
      "/nested/capture/quick-add",
    ]) {
      expect(requiresDocumentNavigation(path)).toBe(false);
    }
  });
});

const authState: { user: { id: string } | null; isLoading: boolean } = {
  user: null,
  isLoading: false,
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: authState.isLoading,
    signIn: async () => ({ error: null }),
  }),
}));

import LoginPage from "@/pages/LoginPage";

describe("post-login return to the quick-add page", () => {
  const realLocation = window.location;
  let assignCalls: string[] = [];

  beforeEach(() => {
    cleanup();
    assignCalls = [];
    authState.user = { id: "user-1" };
    authState.isLoading = false;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        href: "http://localhost/login",
        origin: "http://localhost",
        pathname: "/login",
        search: "",
        hash: "",
        assign: (url: string) => assignCalls.push(url),
        replace: () => {},
        reload: () => {},
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  function renderLoginReturningTo(from: string | undefined) {
    return render(
      <MemoryRouter
        initialEntries={[{ pathname: "/login", state: from ? { from } : null }]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>dashboard</div>} />
          <Route path="/vault" element={<div>vault page</div>} />
          <Route path={QUICK_ADD_PATH} element={<div>quick add rendered in-app</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("does a FULL page load, so the manifest-free document is what gets served", async () => {
    renderLoginReturningTo(QUICK_ADD_PATH);

    await waitFor(() => expect(assignCalls).toEqual([QUICK_ADD_PATH]));
    // A client-side <Navigate> would have rendered the route inside the
    // already-loaded index.html document, which links the manifest.
    expect(screen.queryByText("quick add rendered in-app")).not.toBeInTheDocument();
  });

  it("still uses client-side navigation for every other destination", async () => {
    renderLoginReturningTo("/vault");

    expect(await screen.findByText("vault page")).toBeInTheDocument();
    expect(assignCalls).toEqual([]);
  });

  it("falls back to the dashboard with no return path, without a reload", async () => {
    renderLoginReturningTo(undefined);

    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(assignCalls).toEqual([]);
  });
});
