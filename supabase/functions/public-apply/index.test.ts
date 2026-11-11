// Tests for public-apply (creator and actor application forms), with a fake database.
//   deno test -A supabase/functions/public-apply/index.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("PUBLIC_APPLY_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

const DRAFT = "11111111-1111-4111-8111-111111111111";

interface Opts {
  limited?: string[];
  beginResult?: string | null;
  reserve?: Record<string, unknown>;
  submitResult?: string;
  files?: string[];
}

function fakeDb(o: Opts = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const listed: string[] = [];
  const db = {
    calls,
    listed,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "public_link_rate_hit") {
        const blocked = (o.limited ?? []).some((p) => String(args.p_key).startsWith(p));
        return Promise.resolve({ data: !blocked, error: null });
      }
      if (name === "public_application_begin") return Promise.resolve({ data: o.beginResult === undefined ? DRAFT : o.beginResult, error: null });
      if (name === "public_application_reserve_file") return Promise.resolve({ data: o.reserve ?? { status: "ok", bucket: "creator-application-videos" }, error: null });
      if (name === "public_application_submit") return Promise.resolve({ data: o.submitResult ?? "ok", error: null });
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUploadUrl(path: string) {
            return Promise.resolve({ data: { signedUrl: `https://signed.example/${bucket}/${path}`, token: "t", path }, error: null });
          },
          list(folder: string) {
            listed.push(`${bucket}/${folder}`);
            return Promise.resolve({ data: (o.files ?? []).filter((f) => f.startsWith(folder + "/")).map((f) => ({ name: f.slice(folder.length + 1) })), error: null });
          },
        };
      },
    },
  };
  return db;
}

const req = (body: unknown, raw = false) =>
  new Request("https://example.test/functions/v1/public-apply", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

Deno.test("begin returns a draft id", async () => {
  const res = await mod.handler(req({ kind: "creator", action: "begin" }), fakeDb());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).draft_id, DRAFT);
});

Deno.test("begin is refused when the address has started too many", async () => {
  assertEquals((await mod.handler(req({ kind: "creator", action: "begin" }), fakeDb({ beginResult: null }))).status, 429);
  assertEquals((await mod.handler(req({ kind: "creator", action: "begin" }), fakeDb({ limited: ["apply-begin:"] }))).status, 429);
});

Deno.test("bad kind, bad action, bad json, GET", async () => {
  assertEquals((await mod.handler(req({ kind: "x", action: "begin" }), fakeDb())).status, 400);
  assertEquals((await mod.handler(req({ kind: "creator", action: "delete" }), fakeDb())).status, 400);
  assertEquals((await mod.handler(req("{no", true), fakeDb())).status, 400);
  assertEquals((await mod.handler(new Request("https://example.test/", { method: "GET" }), fakeDb())).status, 405);
});

Deno.test("an oversized payload is 413", async () => {
  const res = await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, pad: "x".repeat(40000) }), fakeDb());
  assertEquals(res.status, 413);
});

Deno.test("upload_url: a path inside the draft's own folder, extension from the type", async () => {
  const res = await mod.handler(req({ kind: "creator", action: "upload_url", draft_id: DRAFT, file_kind: "video", size: 1000, mime: "video/mp4" }), fakeDb());
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(new RegExp(`^applications/${DRAFT}/video/[0-9a-f]{24}\\.mp4$`).test(body.path), body.path);
  assertEquals(body.bucket, "creator-application-videos");
});

Deno.test("upload_url: refuses a bad draft id, bad file kind, and a draft the database does not know", async () => {
  assertEquals((await mod.handler(req({ kind: "creator", action: "upload_url", draft_id: "nope", file_kind: "video", size: 1, mime: "video/mp4" }), fakeDb())).status, 400);
  assertEquals((await mod.handler(req({ kind: "creator", action: "upload_url", draft_id: DRAFT, file_kind: "script", size: 1, mime: "video/mp4" }), fakeDb())).status, 400);
  assertEquals((await mod.handler(req({ kind: "creator", action: "upload_url", draft_id: DRAFT, file_kind: "video", size: 1, mime: "video/mp4" }), fakeDb({ reserve: { status: "not_found" } }))).status, 404);
});

Deno.test("upload_url: expired, used, too large, wrong type, too many files", async () => {
  const cases: [string, number][] = [["expired", 410], ["used", 410], ["too_large", 413], ["bad_type", 400], ["too_many", 400]];
  for (const [status, code] of cases) {
    const res = await mod.handler(req({ kind: "actor", action: "upload_url", draft_id: DRAFT, file_kind: "video", size: 1, mime: "video/mp4" }), fakeDb({ reserve: { status } }));
    assertEquals(res.status, code, status);
  }
});

Deno.test("upload_url: limits per address and per draft", async () => {
  for (const p of ["apply-upload:", "apply-upload-draft:"]) {
    const db = fakeDb({ limited: [p] });
    assertEquals((await mod.handler(req({ kind: "creator", action: "upload_url", draft_id: DRAFT, file_kind: "video", size: 1, mime: "video/mp4" }), db)).status, 429, p);
    assert(!db.calls.some((c) => c.name === "public_application_reserve_file"));
  }
});

const PAYLOAD = {
  name: "Sam", email: "sam@example.test",
  headshot_path: `applications/${DRAFT}/headshot/a.jpg`,
  videos: [{ storage_path: `applications/${DRAFT}/video/a.mp4` }, { storage_path: `applications/${DRAFT}/video/b.mp4` }, { storage_path: `applications/${DRAFT}/video/c.mp4` }],
};
const FILES = [`applications/${DRAFT}/headshot/a.jpg`, `applications/${DRAFT}/video/a.mp4`, `applications/${DRAFT}/video/b.mp4`, `applications/${DRAFT}/video/c.mp4`];

Deno.test("submit succeeds when every named file exists in the draft folder", async () => {
  const db = fakeDb({ files: FILES });
  const res = await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, payload: PAYLOAD }), db);
  assertEquals(res.status, 200);
  const call = db.calls.find((c) => c.name === "public_application_submit")!;
  assertEquals(call.args.p_draft_id, DRAFT);
  assertEquals(call.args.p_kind, "creator");
  assert(db.listed.every((l) => l.includes(`applications/${DRAFT}/`)));
});

Deno.test("submit: a file that was never uploaded, or another application's file, is refused before any write", async () => {
  const db = fakeDb({ files: FILES.slice(0, 3) });
  assertEquals((await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, payload: PAYLOAD }), db)).status, 400);
  assert(!db.calls.some((c) => c.name === "public_application_submit"));
  const other = { ...PAYLOAD, headshot_path: "applications/22222222-2222-4222-8222-222222222222/headshot/a.jpg" };
  assertEquals((await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, payload: other }), fakeDb({ files: FILES }))).status, 400);
});

Deno.test("submit: the hidden field gets a thank you and writes nothing", async () => {
  const db = fakeDb({ files: FILES });
  const res = await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, payload: PAYLOAD, company_website: "http://spam.example" }), db);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
  assert(!db.calls.some((c) => c.name === "public_application_submit"));
});

Deno.test("submit: too fast looks like success but the database decides", async () => {
  const res = await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, payload: PAYLOAD }), fakeDb({ files: FILES, submitResult: "too_fast" }));
  assertEquals(res.status, 200);
});

Deno.test("submit: database answers map to plain statuses", async () => {
  const cases: [string, number][] = [["not_found", 404], ["expired", 410], ["used", 410], ["too_many", 429], ["invalid:email", 400]];
  for (const [r, code] of cases) {
    const res = await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, payload: PAYLOAD }), fakeDb({ files: FILES, submitResult: r }));
    assertEquals(res.status, code, r);
  }
});

Deno.test("submit: limits, bad draft id, missing payload", async () => {
  assertEquals((await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, payload: PAYLOAD }), fakeDb({ files: FILES, limited: ["apply-submit:"] }))).status, 429);
  assertEquals((await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT, payload: PAYLOAD }), fakeDb({ files: FILES, limited: ["ip:"] }))).status, 429);
  assertEquals((await mod.handler(req({ kind: "creator", action: "submit", draft_id: "x", payload: PAYLOAD }), fakeDb())).status, 400);
  assertEquals((await mod.handler(req({ kind: "creator", action: "submit", draft_id: DRAFT }), fakeDb())).status, 400);
});

Deno.test("a rate limit database error fails closed", async () => {
  const db = fakeDb();
  db.rpc = () => Promise.resolve({ data: null, error: { message: "down" } });
  assertEquals((await mod.handler(req({ kind: "creator", action: "begin" }), db)).status, 429);
});
