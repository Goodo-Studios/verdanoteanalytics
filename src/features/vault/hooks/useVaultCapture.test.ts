// US-005 — unit coverage of the shared capture service.
//
// The US-003 / US-004 route suites drive this module through a page, but both
// pages guard themselves first: a client-role account and a signed-out visitor
// are stopped by RouteGuard/AuthProvider and never reach `captureUrlToVault` at
// all. So the service's OWN gate — the one that is supposed to hold for every
// surface, including a non-React caller — has no coverage from those suites.
// That is what this file tests, at the unit boundary: the exported service
// functions called directly, with only the Supabase client and `fetch` faked.
//
// "No row created" is asserted the only way a client-side unit test honestly
// can: `vault-save` is what creates the inspiration_items row, so the assertion
// is that the edge function was never called, nothing was uploaded to storage,
// and no table write was attempted.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Role = "builder" | "employee" | "client";

/** Session + role the fake Supabase client will report. */
const authState: {
  session: unknown;
  role: Role | null;
  roleError: { message: string } | null;
} = { session: null, role: null, roleError: null };

/** Every storage upload the service attempted. */
const uploadCalls: Array<{ bucket: string; path: string; body: unknown }> = [];
/** Every direct table write the service attempted (tags / notes). */
const tableWrites: Array<{ table: string; op: "upsert" | "update"; payload: unknown }> = [];
/** Every get_user_role lookup, so "the gate resolved the role itself" is assertable. */
const roleLookups: string[] = [];

let uploadError: { message: string } | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: authState.session } }),
    },
    rpc: async (name: string, args: { _user_id: string }) => {
      if (name !== "get_user_role") return { data: null, error: null };
      roleLookups.push(args._user_id);
      if (authState.roleError) return { data: null, error: authState.roleError };
      return { data: authState.role, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown) => {
          uploadCalls.push({ bucket, path, body });
          return uploadError
            ? { data: null, error: uploadError }
            : { data: { path }, error: null };
        },
        createSignedUrl: async () => ({
          data: { signedUrl: "https://signed.example/thumb.jpg" },
          error: null,
        }),
      }),
    },
    from: (table: string) => ({
      upsert: async (payload: unknown) => {
        tableWrites.push({ table, op: "upsert", payload });
        return { error: null };
      },
      update: (payload: unknown) => ({
        eq: async () => {
          tableWrites.push({ table, op: "update", payload });
          return { error: null };
        },
      }),
    }),
  },
}));

import {
  CLIENT_ROLE_MESSAGE,
  VaultCaptureError,
  captureFileToVault,
  captureToVault,
  captureUrlToVault,
  isCaptureForbidden,
  isLoginRequired,
  isSupportedCaptureFile,
  normalizeCaptureUrl,
  useVaultCapture,
} from "./useVaultCapture";

/** Requests the fake vault-save edge function received. */
let vaultSaveCalls: Array<{
  url: string;
  auth: string | null;
  body: Record<string, unknown>;
}> = [];

function signInAs(role: Role, userId = "user-1") {
  authState.role = role;
  authState.session = { access_token: `token-${userId}`, user: { id: userId } };
}

function signOut() {
  authState.role = null;
  authState.session = null;
}

/** Nothing reached the server: no item row, no storage object, no tag/note write. */
function expectNothingCaptured() {
  expect(vaultSaveCalls).toHaveLength(0);
  expect(uploadCalls).toHaveLength(0);
  expect(tableWrites).toHaveLength(0);
}

/** Assert a rejection is a handled VaultCaptureError carrying `reason`. */
async function expectCaptureError(
  run: () => Promise<unknown>,
  reason: VaultCaptureError["reason"],
): Promise<VaultCaptureError> {
  const err = await run().then(
    () => {
      throw new Error("expected the capture to reject");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(VaultCaptureError);
  expect((err as VaultCaptureError).reason).toBe(reason);
  return err as VaultCaptureError;
}

const imageFile = (name = "screenshot.png", type = "image/png") =>
  new File(["img-bytes"], name, { type });

beforeEach(() => {
  signOut();
  authState.roleError = null;
  vaultSaveCalls = [];
  uploadCalls.length = 0;
  tableWrites.length = 0;
  roleLookups.length = 0;
  uploadError = null;

  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      vaultSaveCalls.push({
        url: String(input),
        auth: headers.Authorization ?? null,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({ item_id: "item-123" }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// AC 1 — the URL path works for both capture-capable roles
// ---------------------------------------------------------------------------

describe("captureUrlToVault: allowed roles", () => {
  it.each(["builder", "employee"] as const)(
    "captures a link for a %s account",
    async (role) => {
      signInAs(role);

      const result = await captureUrlToVault("https://www.instagram.com/reel/abc123/");

      expect(result).toEqual({ itemId: "item-123" });
      expect(vaultSaveCalls).toHaveLength(1);
      expect(vaultSaveCalls[0].url).toBe(
        "https://project.supabase.co/functions/v1/vault-save",
      );
      expect(vaultSaveCalls[0].body).toEqual({
        url: "https://www.instagram.com/reel/abc123/",
        brand_name: null,
      });
      // A link capture must not touch storage — that is the file path's job.
      expect(uploadCalls).toHaveLength(0);
    },
  );

  it("sends the caller's session JWT, never an API key", async () => {
    // verdanote-in-app-ui-uses-session-authed-edge-function-not-api: in-app UI
    // authenticates as the user against the first-party edge function.
    signInAs("builder", "user-7");

    await captureUrlToVault("https://example.com/post");

    expect(vaultSaveCalls[0].auth).toBe("Bearer token-user-7");
    expect(vaultSaveCalls[0].url).not.toMatch(/\/functions\/v1\/api\b/);
  });

  it("resolves the role itself when the caller does not supply one", async () => {
    // This is what makes the gate hold for a non-React caller with no
    // AuthContext to read from.
    signInAs("employee", "user-9");

    await captureUrlToVault("https://example.com/post");

    expect(roleLookups).toEqual(["user-9"]);
  });

  it("trusts a role the caller already knows, without a second round-trip", async () => {
    signInAs("builder");

    await captureUrlToVault("https://example.com/post", undefined, { role: "builder" });

    expect(roleLookups).toHaveLength(0);
    expect(vaultSaveCalls).toHaveLength(1);
  });

  it("attaches tags and notes to the new item", async () => {
    signInAs("builder");

    await captureUrlToVault("https://example.com/post", {
      brandName: "  Acme  ",
      tags: [" Skincare ", "UGC", "  "],
      notes: "  strong hook  ",
    });

    expect(vaultSaveCalls[0].body.brand_name).toBe("Acme");
    expect(tableWrites).toEqual([
      {
        table: "inspiration_tags",
        op: "upsert",
        payload: [
          { item_id: "item-123", tag: "skincare" },
          { item_id: "item-123", tag: "ugc" },
        ],
      },
      { table: "inspiration_items", op: "update", payload: { ad_body_text: "strong hook" } },
    ]);
  });

  it("does not lock out a legitimate role when the role lookup returns nothing", async () => {
    // Deliberate: only `client` is refused. An unresolved role is left to the
    // server-side checks (RLS + edge-function auth) rather than blocking a
    // builder on a null RPC result.
    signInAs("builder");
    authState.role = null;

    await expect(captureUrlToVault("https://example.com/post")).resolves.toEqual({
      itemId: "item-123",
    });
  });
});

// ---------------------------------------------------------------------------
// AC 2 — the image path works for both capture-capable roles
// ---------------------------------------------------------------------------

describe("captureFileToVault: allowed roles", () => {
  it.each(["builder", "employee"] as const)(
    "captures an image for a %s account",
    async (role) => {
      signInAs(role, `${role}-id`);

      const result = await captureFileToVault(imageFile());

      expect(result).toEqual({ itemId: "item-123" });

      // Uploaded to the same bucket / path shape the desktop CaptureModal uses.
      expect(uploadCalls).toHaveLength(1);
      expect(uploadCalls[0].bucket).toBe("inspiration-media");
      expect(uploadCalls[0].path).toMatch(new RegExp(`^uploads/${role}-id/\\d+\\.png$`));

      // A static image goes to vault-analyze's image-only branch server-side,
      // which is what `file_path` + an image mime type (and no `url`) selects.
      expect(vaultSaveCalls).toHaveLength(1);
      expect(vaultSaveCalls[0].auth).toBe(`Bearer token-${role}-id`);
      expect(vaultSaveCalls[0].body).toMatchObject({
        platform: "upload",
        mime_type: "image/png",
        thumbnail_url: null,
      });
      expect(vaultSaveCalls[0].body.file_path).toBe(uploadCalls[0].path);
      expect(vaultSaveCalls[0].body).not.toHaveProperty("url");
    },
  );

  it("accepts a jpeg screenshot, the usual phone capture", async () => {
    signInAs("employee", "user-1");

    await captureFileToVault(imageFile("IMG_0421.JPG", "image/jpeg"));

    expect(uploadCalls[0].path).toMatch(/^uploads\/user-1\/\d+\.JPG$/);
    expect(vaultSaveCalls[0].body.mime_type).toBe("image/jpeg");
  });

  it("does not attempt a poster frame for a still image", async () => {
    // Thumbnail generation is video-only; an image must produce exactly one
    // upload (the file itself), not a second one for a thumbnail.
    signInAs("builder");

    await captureFileToVault(imageFile());

    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].path).not.toContain("thumbnails/");
  });

  it("surfaces an upload failure as a handled error, before any item is created", async () => {
    signInAs("builder");
    uploadError = { message: "Storage unavailable" };

    const err = await expectCaptureError(() => captureFileToVault(imageFile()), "failed");
    expect(err.message).toBe("Storage unavailable");
    expect(vaultSaveCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC 3 — the client role is rejected on both paths, with no row created
// ---------------------------------------------------------------------------

describe("client-role accounts are refused by the service itself", () => {
  it("rejects a link capture", async () => {
    signInAs("client");

    const err = await expectCaptureError(
      () => captureUrlToVault("https://www.instagram.com/reel/abc123/"),
      "forbidden",
    );
    expect(err.message).toBe(CLIENT_ROLE_MESSAGE);
    expect(isCaptureForbidden(err)).toBe(true);
    expect(isLoginRequired(err)).toBe(false);
    expectNothingCaptured();
  });

  it("rejects an image capture", async () => {
    signInAs("client");

    const err = await expectCaptureError(
      () => captureFileToVault(imageFile()),
      "forbidden",
    );
    expect(err.message).toBe(CLIENT_ROLE_MESSAGE);
    expectNothingCaptured();
  });

  it("rejects even when the caller asserts the role, so no surface can opt out", async () => {
    // A surface passing `role` skips the RPC. It must not be able to smuggle a
    // client account through by doing so.
    signInAs("client");

    await expectCaptureError(
      () => captureUrlToVault("https://example.com/post", undefined, { role: "client" }),
      "forbidden",
    );
    await expectCaptureError(
      () => captureFileToVault(imageFile(), undefined, { role: "client" }),
      "forbidden",
    );
    expectNothingCaptured();
  });

  it("writes no tags or notes either, since there is no item to attach them to", async () => {
    signInAs("client");

    await expectCaptureError(
      () =>
        captureUrlToVault("https://example.com/post", {
          tags: ["skincare"],
          notes: "nice hook",
        }),
      "forbidden",
    );
    expectNothingCaptured();
  });

  it("refuses through the captureToVault entry point too", async () => {
    signInAs("client");

    await expectCaptureError(
      () => captureToVault({ type: "url", url: "https://example.com/post" }),
      "forbidden",
    );
    await expectCaptureError(
      () => captureToVault({ type: "file", file: imageFile() }),
      "forbidden",
    );
    expectNothingCaptured();
  });
});

// ---------------------------------------------------------------------------
// AC 4 — no session signals "redirect to login" on both paths
// ---------------------------------------------------------------------------

describe("no session signals a login redirect", () => {
  it("signals it on the link path", async () => {
    signOut();

    const err = await expectCaptureError(
      () => captureUrlToVault("https://example.com/post"),
      "unauthenticated",
    );
    expect(isLoginRequired(err)).toBe(true);
    expect(isCaptureForbidden(err)).toBe(false);
    expectNothingCaptured();
  });

  it("signals it on the image path", async () => {
    signOut();

    const err = await expectCaptureError(
      () => captureFileToVault(imageFile()),
      "unauthenticated",
    );
    expect(isLoginRequired(err)).toBe(true);
    expectNothingCaptured();
  });

  it("treats a session with no access token as no session", async () => {
    // An expired/partial session must redirect to login rather than send an
    // `Authorization: Bearer undefined` request the edge function would 401.
    authState.role = "builder";
    authState.session = { user: { id: "user-1" } };

    await expectCaptureError(() => captureUrlToVault("https://example.com/post"), "unauthenticated");
    await expectCaptureError(() => captureFileToVault(imageFile()), "unauthenticated");
    expectNothingCaptured();
  });

  it("checks the session before the role, so a signed-out visitor is not asked to prove a role", async () => {
    signOut();

    await expectCaptureError(() => captureUrlToVault("https://example.com/post"), "unauthenticated");
    expect(roleLookups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC 5 — malformed URLs and unsupported files are handled errors, never throws
// ---------------------------------------------------------------------------

describe("malformed input is a handled error", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["not a URL at all", "not a link"],
    ["a bare domain with no scheme", "instagram.com/reel/abc"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["an unsupported scheme", "ftp://example.com/post"],
  ])("rejects %s with invalid-input rather than an unhandled exception", async (_label, raw) => {
    signInAs("builder");

    const err = await expectCaptureError(() => captureUrlToVault(raw), "invalid-input");
    // A raw `new URL()` TypeError would leak out as an unhandled rejection on a
    // capture surface; every rejection here is the module's own error type.
    expect(err).not.toBeInstanceOf(TypeError);
    expect(err.message).toMatch(/link/i);
    expectNothingCaptured();
  });

  it("normalizes a valid link by trimming, and keeps the query string intact", () => {
    expect(normalizeCaptureUrl("  https://www.tiktok.com/@a/video/1?is_from=x  ")).toBe(
      "https://www.tiktok.com/@a/video/1?is_from=x",
    );
    expect(normalizeCaptureUrl("http://example.com")).toBe("http://example.com");
  });

  it.each([
    ["a PDF", "brief.pdf", "application/pdf"],
    ["a text file", "notes.txt", "text/plain"],
    ["a zip", "assets.zip", "application/zip"],
    ["a file the OS could not type", "unknown", ""],
  ])("rejects %s with invalid-input and uploads nothing", async (_label, name, type) => {
    signInAs("builder");

    const err = await expectCaptureError(
      () => captureFileToVault(new File(["bytes"], name, { type })),
      "invalid-input",
    );
    expect(err.message).toBe("Only video and image files are supported");
    expectNothingCaptured();
    // Rejected before the session/role check, so nothing was looked up either.
    expect(roleLookups).toHaveLength(0);
  });

  it("agrees with isSupportedCaptureFile about what is capturable", () => {
    expect(isSupportedCaptureFile(imageFile())).toBe(true);
    expect(isSupportedCaptureFile(new File([""], "clip.mp4", { type: "video/mp4" }))).toBe(true);
    expect(isSupportedCaptureFile(new File([""], "brief.pdf", { type: "application/pdf" }))).toBe(false);
    expect(isSupportedCaptureFile(null)).toBe(false);
    expect(isSupportedCaptureFile(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The React wrapper: same rules, surfaced as flags instead of throws. This is
// the contract the share-target route and the quick-add page actually consume.
// ---------------------------------------------------------------------------

describe("useVaultCapture", () => {
  it("reports a saved capture", async () => {
    signInAs("builder");
    const { result } = renderHook(() => useVaultCapture());

    await act(async () => {
      await result.current.captureUrl("https://example.com/post");
    });

    expect(result.current.status).toBe("saved");
    expect(result.current.result).toEqual({ itemId: "item-123" });
    expect(result.current.error).toBeNull();
    expect(result.current.needsLogin).toBe(false);
    expect(result.current.forbidden).toBe(false);
  });

  it("raises `forbidden` for a client account instead of throwing", async () => {
    signInAs("client");
    const { result } = renderHook(() => useVaultCapture());

    let returned: unknown = "unset";
    await act(async () => {
      returned = await result.current.captureFile(imageFile());
    });

    expect(returned).toBeNull();
    expect(result.current.status).toBe("error");
    expect(result.current.forbidden).toBe(true);
    expect(result.current.needsLogin).toBe(false);
    expect(result.current.error?.message).toBe(CLIENT_ROLE_MESSAGE);
    expectNothingCaptured();
  });

  it("raises `needsLogin` on both paths when there is no session", async () => {
    signOut();
    const { result } = renderHook(() => useVaultCapture());

    await act(async () => {
      await result.current.captureUrl("https://example.com/post");
    });
    expect(result.current.needsLogin).toBe(true);

    await act(async () => {
      await result.current.captureFile(imageFile());
    });
    expect(result.current.needsLogin).toBe(true);
    expect(result.current.forbidden).toBe(false);
    expectNothingCaptured();
  });

  it("keeps a malformed link an error state, not an unhandled rejection", async () => {
    signInAs("builder");
    const { result } = renderHook(() => useVaultCapture());

    await act(async () => {
      await result.current.captureUrl("not a link");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error?.reason).toBe("invalid-input");
    expect(result.current.needsLogin).toBe(false);
    expect(result.current.forbidden).toBe(false);
    expectNothingCaptured();
  });

  it("clears the failure so the next attempt starts clean", async () => {
    signInAs("client");
    const { result } = renderHook(() => useVaultCapture());

    await act(async () => {
      await result.current.captureUrl("https://example.com/post");
    });
    expect(result.current.forbidden).toBe(true);

    act(() => result.current.reset());

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.forbidden).toBe(false);
    expect(result.current.needsLogin).toBe(false);
  });
});
