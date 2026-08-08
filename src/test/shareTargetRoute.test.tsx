// US-003 — Android native share-target route.
//
// e2eTests (from the PRD):
//   1. An authenticated builder shares a social URL via the OS share sheet →
//      the item lands in the vault.
//   2. Same, but a shared image → the item lands via the image path, with no
//      transcript error.
//   3. A client-role account reaching the route → blocked, no item created.
//   4. No session → redirected to login.
//
// The OS half of that (Chrome's share sheet, an installed PWA) cannot run in
// vitest. What CAN run — and what actually breaks — is everything downstream of
// the share: the manifest contract Chrome reads, the worker's POST→GET
// normalisation, and the route's behaviour once it has the payload.
//
// These are live behavioural tests, not shape assertions. The REAL AuthProvider,
// the REAL useVaultCapture service, and the REAL route render together; only the
// network boundary is faked (an in-memory Supabase client + a fetch stub
// standing in for the vault-save edge function). So "the item appears in the
// vault" is asserted as "vault-save was called, session-authed, with the right
// payload" — the same request the desktop CaptureModal has always made.
import { describe, it, expect, beforeEach, vi } from "vitest";
// fireEvent, not @testing-library/user-event — repo convention (see
// CreativeRotationPage.test.tsx); user-event is not a dependency here.
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Network boundary: one in-memory fake Supabase client, shared by AuthProvider
// (getSession / onAuthStateChange / get_user_role) and useVaultCapture
// (getSession / storage upload).
// ---------------------------------------------------------------------------

type Role = "builder" | "employee" | "client";

const authState: { session: unknown; role: Role | null } = { session: null, role: null };
const uploadCalls: Array<{ bucket: string; path: string; body: unknown }> = [];
let uploadError: { message: string } | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: authState.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
    rpc: async (name: string) => {
      if (name === "get_user_role") return { data: authState.role, error: null };
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown) => {
          uploadCalls.push({ bucket, path, body });
          return uploadError ? { data: null, error: uploadError } : { data: { path }, error: null };
        },
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/x" } }),
      }),
    },
    from: () => ({
      upsert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

import { AuthProvider } from "@/contexts/AuthContext";
import CaptureShareTarget from "@/pages/CaptureShareTarget";
import {
  SHARE_TARGET_CACHE,
  SHARE_TARGET_PATH,
  SHARE_TARGET_STASH_PREFIX,
  SHARED_FILE_NAME_HEADER,
  extractSharedUrl,
  resolvePostLoginPath,
  takeSharedFile,
} from "@/pwa/shareTarget";

const repoFile = (relativePath: string) => resolve(process.cwd(), relativePath);
const manifest = JSON.parse(readFileSync(repoFile("public/manifest.json"), "utf8"));
const serviceWorkerSource = readFileSync(repoFile("src/sw.ts"), "utf8");

/** Requests the fake vault-save edge function received. */
let vaultSaveCalls: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
let vaultSaveFails = false;
/** When set, vault-save hangs until released — lets a test observe "Saving…". */
let vaultSaveGate: Promise<void> | null = null;

/** Hold vault-save open; returns the release function. */
function deferVaultSave(): () => void {
  let release!: () => void;
  vaultSaveGate = new Promise<void>((resolve) => {
    release = () => {
      vaultSaveGate = null;
      resolve();
    };
  });
  return release;
}

function signInAs(role: Role) {
  authState.role = role;
  authState.session = {
    access_token: "test-access-token",
    user: { id: "user-1" },
  };
}

function signOut() {
  authState.role = null;
  authState.session = null;
}

beforeEach(() => {
  cleanup();
  signOut();
  vaultSaveCalls = [];
  vaultSaveFails = false;
  vaultSaveGate = null;
  uploadCalls.length = 0;
  uploadError = null;
  // The "already saved" marker is tab-scoped, so it would otherwise leak from
  // one test into the next and suppress a legitimate save.
  try {
    sessionStorage.clear();
  } catch {
    // Storage unavailable in this environment — nothing to reset.
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (vaultSaveGate) await vaultSaveGate;
      vaultSaveCalls.push({
        url,
        auth: headers.Authorization ?? null,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      if (vaultSaveFails) {
        return new Response(JSON.stringify({ error: "Extraction service unavailable" }), {
          status: 502,
        });
      }
      return new Response(JSON.stringify({ item_id: "item-123" }), { status: 200 });
    }),
  );
});

/** Records where the router ended up, so redirects are assertable. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div
      data-testid="location"
      data-pathname={location.pathname}
      data-from={(location.state as { from?: string } | null)?.from ?? ""}
    />
  );
}

function renderShareTarget(search: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`${SHARE_TARGET_PATH}${search}`]}>
        <LocationProbe />
        <Routes>
          <Route path={SHARE_TARGET_PATH} element={<CaptureShareTarget />} />
          <Route path="/login" element={<div>Sign in to Verdanote</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

// ---------------------------------------------------------------------------
// The manifest contract Chrome reads to put "Verdanote Vault" in the share sheet
// ---------------------------------------------------------------------------

describe("US-003: manifest share_target", () => {
  it("points at the route this story adds", () => {
    expect(manifest.share_target?.action).toBe(SHARE_TARGET_PATH);
  });

  it("posts multipart, the only shape that can carry a shared file", () => {
    // A GET share_target silently drops `files` — the photo half of this story.
    expect(String(manifest.share_target.method).toUpperCase()).toBe("POST");
    expect(manifest.share_target.enctype).toBe("multipart/form-data");
  });

  it("declares the text params Android fills for a link share", () => {
    expect(manifest.share_target.params).toMatchObject({
      title: "title",
      text: "text",
      url: "url",
    });
  });

  it("accepts images, under the param name the worker reads", () => {
    const files = manifest.share_target.params.files;
    expect(Array.isArray(files)).toBe(true);
    expect(files[0].name).toBe("image");
    expect(files[0].accept).toContain("image/*");
    expect(serviceWorkerSource).toContain('getAll("image")');
  });

  it("keeps the action inside the manifest scope, or Chrome ignores it", () => {
    expect(SHARE_TARGET_PATH.startsWith(manifest.scope)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The worker is a classic script and cannot import the shared module, so its
// copy of the constants is duplicated. Catch the drift that would silently
// break every photo share.
// ---------------------------------------------------------------------------

describe("US-003: service worker share handling", () => {
  it("intercepts POSTs to the share-target path", () => {
    expect(serviceWorkerSource).toContain(`const SHARE_TARGET_PATH = "${SHARE_TARGET_PATH}"`);
    expect(serviceWorkerSource).toMatch(/request\.method !== "POST"/);
    expect(serviceWorkerSource).toMatch(/event\.respondWith\(/);
  });

  it("uses the same cache name and key prefix the page reads from", () => {
    expect(serviceWorkerSource).toContain(`const SHARE_TARGET_CACHE = "${SHARE_TARGET_CACHE}"`);
    expect(serviceWorkerSource).toContain(
      `const SHARE_TARGET_STASH_PREFIX = "${SHARE_TARGET_STASH_PREFIX}"`,
    );
    expect(serviceWorkerSource).toContain(
      `const SHARED_FILE_NAME_HEADER = "${SHARED_FILE_NAME_HEADER}"`,
    );
  });

  it("redirects with 303 so the browser follows up with a GET, not a replayed POST", () => {
    expect(serviceWorkerSource).toMatch(/Response\.redirect\(.*,\s*303\s*\)/);
  });

  it("stays import-free, or the emitted classic worker fails to parse", () => {
    const code = serviceWorkerSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// URL extraction — the part that decides whether a real Instagram/TikTok share
// saves anything at all.
// ---------------------------------------------------------------------------

describe("US-003: extractSharedUrl", () => {
  const extract = (init: Record<string, string>) => extractSharedUrl(new URLSearchParams(init));

  it("takes the url param when Android fills it", () => {
    expect(extract({ url: "https://www.instagram.com/reel/abc123/" })).toBe(
      "https://www.instagram.com/reel/abc123/",
    );
  });

  it("finds the link inside a text share, which is what Instagram actually sends", () => {
    expect(
      extract({ text: "Check this out https://www.instagram.com/reel/abc123/ so good" }),
    ).toBe("https://www.instagram.com/reel/abc123/");
  });

  it("keeps a TikTok query string intact", () => {
    expect(extract({ text: "https://vt.tiktok.com/ZS123/?k=1" })).toBe(
      "https://vt.tiktok.com/ZS123/?k=1",
    );
  });

  it("drops sentence punctuation that trails a link in prose", () => {
    expect(extract({ text: "look at https://example.com/post/9." })).toBe(
      "https://example.com/post/9",
    );
  });

  it("prefers url over text when both are present", () => {
    expect(extract({ url: "https://a.example/1", text: "https://b.example/2" })).toBe(
      "https://a.example/1",
    );
  });

  it("returns null when the share carries no link", () => {
    expect(extract({ text: "just some words" })).toBeNull();
    expect(extract({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The Cache handoff between worker and page.
// ---------------------------------------------------------------------------

/** Minimal in-memory CacheStorage, standing in for the worker's stash. */
function fakeCacheStorage() {
  const entries = new Map<string, Response>();
  return {
    entries,
    storage: {
      open: async () => ({
        match: async (key: string) => entries.get(key),
        put: async (key: string, response: Response) => void entries.set(key, response),
        delete: async (key: string) => entries.delete(key),
      }),
    } as unknown as CacheStorage,
  };
}

function stashFile(cache: ReturnType<typeof fakeCacheStorage>, key: string, file: File) {
  cache.entries.set(
    SHARE_TARGET_STASH_PREFIX + key,
    new Response(file, {
      headers: {
        "content-type": file.type,
        [SHARED_FILE_NAME_HEADER]: file.name,
      },
    }),
  );
}

describe("US-003: takeSharedFile", () => {
  it("reconstructs the shared file, name and type included", async () => {
    const cache = fakeCacheStorage();
    stashFile(cache, "k1", new File(["bytes"], "reel.jpg", { type: "image/jpeg" }));

    const file = await takeSharedFile("k1", cache.storage);

    expect(file).toBeInstanceOf(File);
    expect(file!.name).toBe("reel.jpg");
    expect(file!.type).toBe("image/jpeg");
  });

  it("consumes the entry, so a refresh cannot save the same share twice", async () => {
    const cache = fakeCacheStorage();
    stashFile(cache, "k1", new File(["bytes"], "reel.jpg", { type: "image/jpeg" }));

    expect(await takeSharedFile("k1", cache.storage)).toBeInstanceOf(File);
    expect(await takeSharedFile("k1", cache.storage)).toBeNull();
  });

  it("resolves null instead of throwing when the Cache API is absent", async () => {
    expect(await takeSharedFile("k1", undefined)).toBeNull();
    expect(await takeSharedFile(null, fakeCacheStorage().storage)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// e2eTest 1 — builder shares a link
// ---------------------------------------------------------------------------

describe("US-003: sharing a link", () => {
  it("saves it to the vault and confirms, without asking the user to tap anything", async () => {
    signInAs("builder");
    // Hold the edge function open so the intermediate state is observable
    // rather than a race against the mock resolving in a microtask.
    const releaseVaultSave = deferVaultSave();
    renderShareTarget("?text=Check%20this%20https%3A%2F%2Fwww.instagram.com%2Freel%2Fabc123%2F");

    expect(await screen.findByText("Saving…")).toBeInTheDocument();
    expect(screen.queryByText("Saved ✓")).not.toBeInTheDocument();

    await act(async () => {
      releaseVaultSave();
    });
    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();

    // "Appears in the vault" == the one vault-save call CaptureModal also makes.
    expect(vaultSaveCalls).toHaveLength(1);
    expect(vaultSaveCalls[0].url).toMatch(/\/functions\/v1\/vault-save$/);
    expect(vaultSaveCalls[0].body).toMatchObject({
      url: "https://www.instagram.com/reel/abc123/",
    });
  });

  it("authenticates with the caller's session, not an API key", async () => {
    // Hard requirement of verdanote-in-app-ui-uses-session-authed-edge-function-not-api:
    // the in-app surface carries a session JWT and never touches the `api` function.
    signInAs("employee");
    renderShareTarget("?url=https%3A%2F%2Fexample.com%2Fpost");

    await screen.findByText("Saved ✓");
    expect(vaultSaveCalls[0].auth).toBe("Bearer test-access-token");
    expect(vaultSaveCalls[0].url).not.toMatch(/\/functions\/v1\/api\b/);
  });

  it("tells the user plainly when the share carried nothing savable", async () => {
    signInAs("builder");
    renderShareTarget("?text=no%20link%20here");

    expect(await screen.findByText("Nothing saved")).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A link share is fully replayable from its URL, unlike a photo share whose
// bytes are consumed out of the Cache. Chrome Android's pull-to-refresh is a
// one-finger gesture on exactly this screen, so remounting must not re-save.
// ---------------------------------------------------------------------------

describe("US-003: reloading a share", () => {
  const search = "?url=https%3A%2F%2Fexample.com%2Fpost";

  it("does not save a link twice when the route is remounted", async () => {
    signInAs("builder");

    const first = renderShareTarget(search);
    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(1);

    // Pull-to-refresh: same URL, fresh mount, same tab.
    first.unmount();
    renderShareTarget(search);

    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
    expect(screen.getByText(/already saved this one/i)).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(1);
  });

  it("still saves a genuinely different share in the same tab", async () => {
    signInAs("builder");

    const first = renderShareTarget(search);
    await screen.findByText("Saved ✓");
    first.unmount();

    renderShareTarget("?url=https%3A%2F%2Fexample.com%2Fother");
    await screen.findByText("Saved ✓");

    expect(vaultSaveCalls).toHaveLength(2);
    expect(vaultSaveCalls[1].body).toMatchObject({ url: "https://example.com/other" });
  });
});

// ---------------------------------------------------------------------------
// e2eTest 2 — builder shares an image
// ---------------------------------------------------------------------------

describe("US-003: sharing an image", () => {
  it("uploads the shared photo and saves it through the image path", async () => {
    signInAs("builder");

    const cache = fakeCacheStorage();
    stashFile(cache, "abc", new File(["img-bytes"], "photo.png", { type: "image/png" }));
    vi.stubGlobal("caches", cache.storage);

    renderShareTarget("?shared-file=abc");

    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();

    // Uploaded to the same bucket CaptureModal's upload tab uses.
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].bucket).toBe("inspiration-media");
    expect(uploadCalls[0].path).toMatch(/^uploads\/user-1\/\d+\.png$/);

    // Static image → vault-save gets file_path + an image mime type, so the
    // server takes vault-analyze's image-only branch (no transcript attempted).
    expect(vaultSaveCalls).toHaveLength(1);
    expect(vaultSaveCalls[0].body).toMatchObject({
      platform: "upload",
      mime_type: "image/png",
    });
    expect(vaultSaveCalls[0].body.file_path).toMatch(/^uploads\/user-1\//);
    expect(vaultSaveCalls[0].body).not.toHaveProperty("url");
  });

  it("reports an upload failure with a retry rather than failing silently", async () => {
    signInAs("builder");
    uploadError = { message: "Storage unavailable" };

    const cache = fakeCacheStorage();
    stashFile(cache, "abc", new File(["img"], "photo.png", { type: "image/png" }));
    vi.stubGlobal("caches", cache.storage);

    renderShareTarget("?shared-file=abc");

    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(screen.getByText("Storage unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// e2eTest 3 — client role is blocked
// ---------------------------------------------------------------------------

describe("US-003: client-role account", () => {
  it("shows a blocked screen and never attempts a save", async () => {
    signInAs("client");
    renderShareTarget("?url=https%3A%2F%2Fwww.instagram.com%2Freel%2Fabc123%2F");

    expect(await screen.findByText("Not available")).toBeInTheDocument();
    expect(
      screen.getByText("Saving to the Vault is not available for your account."),
    ).toBeInTheDocument();

    // No item created: no edge-function call, no storage write.
    expect(vaultSaveCalls).toHaveLength(0);
    expect(uploadCalls).toHaveLength(0);
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
  });

  it("blocks a shared image too, not just a link", async () => {
    signInAs("client");

    const cache = fakeCacheStorage();
    stashFile(cache, "abc", new File(["img"], "photo.png", { type: "image/png" }));
    vi.stubGlobal("caches", cache.storage);

    renderShareTarget("?shared-file=abc");

    expect(await screen.findByText("Not available")).toBeInTheDocument();
    expect(uploadCalls).toHaveLength(0);
    expect(vaultSaveCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// e2eTest 4 — no session
// ---------------------------------------------------------------------------

describe("US-003: unauthenticated visit", () => {
  it("redirects to login", async () => {
    signOut();
    renderShareTarget("?url=https%3A%2F%2Fexample.com%2Fpost");

    await waitFor(() =>
      expect(screen.getByTestId("location").dataset.pathname).toBe("/login"),
    );
    expect(screen.getByText("Sign in to Verdanote")).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(0);
  });

  it("carries the share forward so signing in returns to it", async () => {
    signOut();
    renderShareTarget("?url=https%3A%2F%2Fexample.com%2Fpost");

    await waitFor(() =>
      expect(screen.getByTestId("location").dataset.pathname).toBe("/login"),
    );
    const from = screen.getByTestId("location").dataset.from!;
    expect(from).toBe(`${SHARE_TARGET_PATH}?url=https%3A%2F%2Fexample.com%2Fpost`);

    // And LoginPage honours it, so the round-trip actually closes.
    expect(resolvePostLoginPath({ from })).toBe(from);
  });

  it("does not follow an off-site return path", () => {
    // The share URL is attacker-influenced text; a protocol-relative value must
    // not turn the login redirect into an open redirect.
    expect(resolvePostLoginPath({ from: "//evil.example/steal" })).toBe("/");
    expect(resolvePostLoginPath({ from: "https://evil.example" })).toBe("/");
    expect(resolvePostLoginPath(null)).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// Error handling — never a silent failure
// ---------------------------------------------------------------------------

describe("US-003: failure handling", () => {
  it("surfaces an edge-function failure and retries on demand", async () => {
    signInAs("builder");
    vaultSaveFails = true;
    renderShareTarget("?url=https%3A%2F%2Fexample.com%2Fpost");

    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(screen.getByText("Extraction service unavailable")).toBeInTheDocument();

    // Retry re-runs the SAME share — the payload survives the failed attempt.
    vaultSaveFails = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });

    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(2);
    expect(vaultSaveCalls[1].body).toMatchObject({ url: "https://example.com/post" });
  });

  it("explains an unreadable share instead of showing a blank screen", async () => {
    signInAs("builder");
    renderShareTarget("?share-error=1");

    expect(await screen.findByText("Nothing saved")).toBeInTheDocument();
    expect(
      screen.getByText("That share did not come through. Try sharing it again."),
    ).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(0);
  });
});
