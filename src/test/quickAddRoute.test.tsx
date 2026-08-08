// US-004 — the iPhone quick-add page.
//
// e2eTests (from the PRD):
//   1. An authenticated builder pastes a URL and taps Save → the item lands in
//      the vault.
//   2. Same, but a picked photo → the item lands via the image path.
//   3. A client-role account loading the page → blocked, no form, no item.
//   4. No session → redirected to login.
//
// The iOS half (Safari's Add to Home Screen, a standalone launch) cannot run in
// vitest. What CAN run is everything the page itself owns — the form, the two
// capture paths, the gates, the onboarding copy — plus the static contract that
// makes a standalone launch possible (the route being registered, and the meta
// tags Safari reads).
//
// Same approach as the US-003 suite: the REAL AuthProvider, the REAL
// useVaultCapture service and the REAL page render together, and only the
// network boundary is faked. "The item appears in the vault" is asserted as
// "vault-save was called, session-authed, with the right payload".
import { describe, it, expect, beforeEach, vi } from "vitest";
// fireEvent, not @testing-library/user-event — repo convention; user-event is
// not a dependency here.
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
import CaptureQuickAdd from "@/pages/CaptureQuickAdd";
import { ADD_TO_HOME_SCREEN_TIP, QUICK_ADD_PATH } from "@/pwa/quickAdd";

const repoFile = (relativePath: string) => resolve(process.cwd(), relativePath);
const manifest = JSON.parse(readFileSync(repoFile("public/manifest.json"), "utf8"));
const indexHtml = readFileSync(repoFile("index.html"), "utf8");
const appSource = readFileSync(repoFile("src/App.tsx"), "utf8");

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
  // The onboarding tip's dismissal is device-scoped, so it would otherwise leak
  // from one test into the next.
  try {
    localStorage.clear();
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

function renderQuickAdd() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[QUICK_ADD_PATH]}>
        <LocationProbe />
        <Routes>
          <Route path={QUICK_ADD_PATH} element={<CaptureQuickAdd />} />
          <Route path="/login" element={<div>Sign in to Verdanote</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

/**
 * Render and wait for the form. AuthProvider resolves the session
 * asynchronously, so a synchronous query would hit the loading spinner.
 */
async function openQuickAdd() {
  const view = renderQuickAdd();
  await screen.findByLabelText("Paste a link");
  return view;
}

const urlBox = () => screen.getByLabelText("Paste a link");
const fileBox = () => screen.getByLabelText("Photo or video");
const saveButton = () => screen.getByRole("button", { name: /save to vault/i });

/** Type a link into the paste box. */
function pasteLink(value: string) {
  fireEvent.change(urlBox(), { target: { value } });
}

/** Pick a photo through the native file input. */
function pickFile(file: File) {
  fireEvent.change(fileBox(), { target: { files: [file] } });
}

async function tapSave() {
  await act(async () => {
    fireEvent.click(saveButton());
  });
}

// ---------------------------------------------------------------------------
// e2eTest 1 — builder pastes a URL
// ---------------------------------------------------------------------------

describe("US-004: pasting a link", () => {
  it("saves the pasted link through the shared capture service", async () => {
    signInAs("builder");
    await openQuickAdd();

    pasteLink("https://www.instagram.com/reel/abc123/");
    await tapSave();

    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();

    // Same request the desktop CaptureModal has always made.
    expect(vaultSaveCalls).toHaveLength(1);
    expect(vaultSaveCalls[0].url).toContain("/functions/v1/vault-save");
    expect(vaultSaveCalls[0].body).toMatchObject({
      url: "https://www.instagram.com/reel/abc123/",
    });
    expect(uploadCalls).toHaveLength(0);
  });

  it("authenticates with the caller's session, not an API key", async () => {
    // Hard requirement of verdanote-in-app-ui-uses-session-authed-edge-function-not-api:
    // the in-app surface carries a session JWT and never touches the `api` function.
    signInAs("employee");
    await openQuickAdd();

    pasteLink("https://example.com/post");
    await tapSave();

    await screen.findByText("Saved ✓");
    expect(vaultSaveCalls[0].auth).toBe("Bearer test-access-token");
    expect(vaultSaveCalls[0].url).not.toMatch(/\/functions\/v1\/api\b/);
  });

  it("returns to an empty form so the next capture is one tap away", async () => {
    signInAs("builder");
    await openQuickAdd();

    pasteLink("https://example.com/post");
    await tapSave();
    await screen.findByText("Saved ✓");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save another/i }));
    });

    expect(urlBox()).toHaveValue("");
    expect(saveButton()).toBeDisabled();
  });

  it("will not save nothing", async () => {
    signInAs("builder");
    await openQuickAdd();

    expect(saveButton()).toBeDisabled();
    await tapSave();
    expect(vaultSaveCalls).toHaveLength(0);
  });

  it("rejects a value that is not a link, without calling the edge function", async () => {
    signInAs("builder");
    await openQuickAdd();

    pasteLink("not a link");
    await tapSave();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That does not look like a valid link.",
    );
    expect(vaultSaveCalls).toHaveLength(0);
    // The text survives the failure, so a fix is an edit rather than a re-paste.
    expect(urlBox()).toHaveValue("not a link");
  });

  it("does not save twice when Save is double-tapped", async () => {
    signInAs("builder");
    await openQuickAdd();

    const release = deferVaultSave();
    pasteLink("https://example.com/post");

    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(await screen.findByRole("button", { name: /saving/i })).toBeDisabled();

    // The impatient second tap on a phone.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /saving/i }));
    });
    await act(async () => {
      release();
    });

    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// e2eTest 2 — builder adds a photo
// ---------------------------------------------------------------------------

describe("US-004: adding a photo", () => {
  it("uploads the picked photo and saves it through the image path", async () => {
    signInAs("builder");
    await openQuickAdd();

    pickFile(new File(["img-bytes"], "photo.png", { type: "image/png" }));
    expect(await screen.findByText("photo.png")).toBeInTheDocument();

    await tapSave();
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

  it("offers the photo library as well as the camera", async () => {
    // `capture` would force the camera and drop the library option — the more
    // common source for a screenshot of someone else's ad.
    signInAs("builder");
    await openQuickAdd();

    const input = fileBox();
    expect(input).toHaveAttribute("type", "file");
    expect(input.getAttribute("accept")).toContain("image/*");
    expect(input).not.toHaveAttribute("capture");
  });

  it("lets a mis-picked photo be removed before saving", async () => {
    signInAs("builder");
    await openQuickAdd();

    pickFile(new File(["img"], "wrong.png", { type: "image/png" }));
    await screen.findByText("wrong.png");

    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));

    expect(screen.queryByText("wrong.png")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(uploadCalls).toHaveLength(0);
  });

  it("reports an upload failure and keeps the photo for a retry", async () => {
    signInAs("builder");
    uploadError = { message: "Storage unavailable" };
    await openQuickAdd();

    pickFile(new File(["img"], "photo.png", { type: "image/png" }));
    await tapSave();

    expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
    expect(screen.getByText("photo.png")).toBeInTheDocument();

    uploadError = null;
    await tapSave();

    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// e2eTest 3 — client role is blocked
// ---------------------------------------------------------------------------

describe("US-004: client-role account", () => {
  it("shows a blocked message instead of the capture form", async () => {
    signInAs("client");
    renderQuickAdd();

    expect(await screen.findByText("Not available")).toBeInTheDocument();
    expect(
      screen.getByText("Saving to the Vault is not available for your account."),
    ).toBeInTheDocument();

    // No form at all, and nothing attempted.
    expect(screen.queryByLabelText("Paste a link")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Photo or video")).not.toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(0);
    expect(uploadCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// e2eTest 4 — no session
// ---------------------------------------------------------------------------

describe("US-004: unauthenticated visit", () => {
  it("redirects to login", async () => {
    signOut();
    renderQuickAdd();

    await waitFor(() =>
      expect(screen.getByTestId("location").dataset.pathname).toBe("/login"),
    );
    expect(screen.getByText("Sign in to Verdanote")).toBeInTheDocument();
    expect(vaultSaveCalls).toHaveLength(0);
  });

  it("carries this page forward so signing in returns to it", async () => {
    signOut();
    renderQuickAdd();

    await waitFor(() =>
      expect(screen.getByTestId("location").dataset.pathname).toBe("/login"),
    );
    // A fixed same-origin path — LoginPage's resolvePostLoginPath admits it, and
    // unlike the share target there is no attacker-influenced text involved.
    expect(screen.getByTestId("location").dataset.from).toBe(QUICK_ADD_PATH);
  });
});

// ---------------------------------------------------------------------------
// The onboarding line — the one iOS-specific instruction the page has to give,
// since nothing in the OS will ever offer to add this to the share sheet.
// ---------------------------------------------------------------------------

describe("US-004: Add to Home Screen onboarding", () => {
  it("explains how to get one-tap access", async () => {
    signInAs("builder");
    await openQuickAdd();

    expect(await screen.findByText(ADD_TO_HOME_SCREEN_TIP)).toBeInTheDocument();
    expect(ADD_TO_HOME_SCREEN_TIP).toMatch(/Add to Home Screen/i);
    expect(ADD_TO_HOME_SCREEN_TIP).toMatch(/Safari/i);
  });

  it("stays dismissed, so it is genuinely one-time", async () => {
    signInAs("builder");
    const first = await openQuickAdd();

    await screen.findByText(ADD_TO_HOME_SCREEN_TIP);
    fireEvent.click(screen.getByRole("button", { name: /dismiss tip/i }));
    expect(screen.queryByText(ADD_TO_HOME_SCREEN_TIP)).not.toBeInTheDocument();

    first.unmount();
    await openQuickAdd();

    // Form is back; the tip is not.
    expect(await screen.findByLabelText("Paste a link")).toBeInTheDocument();
    expect(screen.queryByText(ADD_TO_HOME_SCREEN_TIP)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The static contract behind "opens standalone from a home-screen icon". iOS
// ignores the manifest, so Safari's meta tags are what actually drop the
// browser chrome — and none of it matters if the path is not routed.
// ---------------------------------------------------------------------------

describe("US-004: standalone launch contract", () => {
  it("routes the path an iOS home-screen icon bookmarks", () => {
    expect(appSource).toContain(`path="${QUICK_ADD_PATH}"`);
    expect(appSource).toContain("CaptureQuickAdd");
  });

  it("keeps the page un-prefixed, since the bookmark cannot know a role", () => {
    expect(QUICK_ADD_PATH).not.toMatch(/^\/(builder|client|employee)\b/);
  });

  it("carries the Safari meta tags that drop the browser chrome", () => {
    expect(indexHtml).toMatch(
      /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/?>/,
    );
    expect(indexHtml).toContain('rel="apple-touch-icon"');
  });

  it("sits inside the manifest scope, for the installed Android case too", () => {
    expect(manifest.display).toBe("standalone");
    expect(QUICK_ADD_PATH.startsWith(manifest.scope)).toBe(true);
  });
});
