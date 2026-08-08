// US-001 — PWA installability foundation.
//
// The story's own acceptance checks (Lighthouse on an HTTPS origin, Android
// Chrome's install prompt, iOS Add-to-Home-Screen) can only be run against a
// deployed build. What IS deterministic — and what actually breaks in practice
// — is the static contract those checks read: the manifest's shape, the icon
// files it points at really existing at the sizes it claims, the iOS meta tags
// Safari needs, and the registration helper never throwing. That's what this
// file locks down. No network, no timers.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  registerServiceWorker,
  SERVICE_WORKER_URL,
  SERVICE_WORKER_SCOPE,
} from "../pwa/registerServiceWorker";

// Vitest runs from the repo root (vitest.config.ts lives there).
const repoFile = (relativePath: string) => resolve(process.cwd(), relativePath);

const manifest = JSON.parse(readFileSync(repoFile("public/manifest.json"), "utf8"));
const indexHtml = readFileSync(repoFile("index.html"), "utf8");
// Comments in sw.ts discuss caching by name; assert against code only.
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const serviceWorkerCode = stripComments(readFileSync(repoFile("src/sw.ts"), "utf8"));
const viteConfig = readFileSync(repoFile("vite.config.ts"), "utf8");

/** Read a PNG's real pixel dimensions out of its IHDR chunk. */
function readPngSize(absolutePath: string): { width: number; height: number } {
  const buffer = readFileSync(absolutePath);
  expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // PNG magic
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("US-001: web app manifest", () => {
  it("declares the fields Chrome's installability check requires", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("ships both icon sizes Chrome and Android need", () => {
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("includes a maskable icon so Android does not letterbox the mark", () => {
    const maskable = manifest.icons.filter(
      (icon: { purpose?: string }) => icon.purpose === "maskable",
    );
    expect(maskable.length).toBeGreaterThan(0);
  });

  it("points every icon at a real PNG of the size it claims", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons as Array<{ src: string; sizes: string; type: string }>) {
      expect(icon.type).toBe("image/png");
      expect(icon.src.startsWith("/")).toBe(true);

      const absolutePath = repoFile(`public${icon.src}`);
      expect(existsSync(absolutePath), `${icon.src} is missing from public/`).toBe(true);

      const [declaredWidth, declaredHeight] = icon.sizes.split("x").map(Number);
      expect(readPngSize(absolutePath)).toEqual({
        width: declaredWidth,
        height: declaredHeight,
      });
    }
  });

  // US-003 adds a `share_target` whose action lives at /capture/share-target.
  // Chrome only honours a share target inside the manifest's scope, so a
  // narrowed scope here would silently break that story.
  it("scopes the app at the root so /capture/* routes stay in scope", () => {
    expect(manifest.scope).toBe("/");
  });
});

describe("US-001: index.html install metadata", () => {
  it("links the manifest", () => {
    expect(indexHtml).toMatch(/<link[^>]+rel="manifest"[^>]+href="\/manifest\.json"/);
  });

  it("declares a theme-color matching the manifest", () => {
    const match = indexHtml.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/);
    expect(match?.[1]).toBe(manifest.theme_color);
  });

  it("ships the iOS Add-to-Home-Screen tags Safari reads instead of the manifest", () => {
    expect(indexHtml).toMatch(
      /<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/,
    );
    expect(indexHtml).toMatch(
      /<meta[^>]+name="apple-mobile-web-app-status-bar-style"[^>]+content="[^"]+"/,
    );
  });

  it("points apple-touch-icon at a real 180x180 PNG", () => {
    const match = indexHtml.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/);
    expect(match?.[1]).toBeTruthy();

    const absolutePath = repoFile(`public${match![1]}`);
    expect(existsSync(absolutePath)).toBe(true);
    expect(readPngSize(absolutePath)).toEqual({ width: 180, height: 180 });
  });
});

describe("US-001: service worker", () => {
  it("registers a fetch handler, which US-003's share-target POST will hang off", () => {
    expect(serviceWorkerCode).toMatch(/addEventListener\(\s*"fetch"/);
  });

  // Offline support is an explicit project non-goal. The signature of app-shell
  // precaching is `cache.addAll([...])` at install time — that is what must not
  // appear. US-003 stashing a shared file with cache.put/IndexedDB is a
  // different thing and is deliberately NOT blocked here.
  it("does not precache an app shell (offline support is a non-goal)", () => {
    expect(serviceWorkerCode).not.toMatch(/addAll\s*\(/);
  });

  // dist/sw.js is registered as a classic script, so it must not be an ES
  // module. It stays classic only as long as sw.ts imports nothing: the moment
  // it shares a module with app code, Rollup emits an `import` into sw.js and
  // registration throws at parse time. If a future story needs to share code,
  // switch the registration to `{ type: "module" }` rather than deleting this.
  it("imports nothing, so the emitted worker stays a classic script", () => {
    expect(serviceWorkerCode).not.toMatch(/^\s*import\s/m);
    expect(serviceWorkerCode).not.toMatch(/\bimport\s*\(/);
    expect(serviceWorkerCode).not.toMatch(/\brequire\s*\(/);
  });
});

// The build wiring is the fragile part of this story: drop either half and every
// other test here still passes while /sw.js 404s in production.
describe("US-001: build emits the worker at the server root", () => {
  it("declares src/sw.ts as its own rollup entry", () => {
    expect(viteConfig).toMatch(/sw:\s*path\.resolve\(__dirname,\s*"src\/sw\.ts"\)/);
  });

  it("emits that entry un-hashed at /sw.js so its scope covers the whole app", () => {
    expect(viteConfig).toMatch(/chunk\.name === "sw" \? "sw\.js"/);
  });
});

describe("US-001: registerServiceWorker", () => {
  const fakeRegistration = {} as ServiceWorkerRegistration;

  it("registers the root-scoped worker when enabled and supported", async () => {
    const calls: Array<[string, RegistrationOptions | undefined]> = [];
    const container = {
      register: (url: string, options?: RegistrationOptions) => {
        calls.push([url, options]);
        return Promise.resolve(fakeRegistration);
      },
    } as unknown as ServiceWorkerContainer;

    const result = await registerServiceWorker({ container, enabled: true });

    expect(result).toEqual({ status: "registered", registration: fakeRegistration });
    expect(calls).toEqual([[SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE }]]);
  });

  it("skips registration in dev builds, where /sw.js does not exist", async () => {
    let called = false;
    const container = {
      register: () => {
        called = true;
        return Promise.resolve(fakeRegistration);
      },
    } as unknown as ServiceWorkerContainer;

    const result = await registerServiceWorker({ container, enabled: false });

    expect(result).toEqual({ status: "skipped", reason: "disabled" });
    expect(called).toBe(false);
  });

  it("skips registration where service workers are unavailable (e.g. insecure origins)", async () => {
    const result = await registerServiceWorker({ container: undefined, enabled: true });
    expect(result).toEqual({ status: "skipped", reason: "unsupported" });
  });

  it("reports a rejected registration instead of throwing into app startup", async () => {
    const error = new Error("registration blocked");
    const container = {
      register: () => Promise.reject(error),
    } as unknown as ServiceWorkerContainer;

    const result = await registerServiceWorker({ container, enabled: true });

    expect(result).toEqual({ status: "failed", error });
  });
});
