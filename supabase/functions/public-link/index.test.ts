// Tests for public-link (approval boards and casting links), with a fake database.
//   deno test -A supabase/functions/public-link/index.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("PUBLIC_LINK_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");
const { sha256Hex } = await import("../_shared/public-link.ts");

const TOKEN = "A".repeat(48);
const UUID = "11111111-1111-4111-8111-111111111111";

const LOCATIONS = {
  status: "ok", label: "Spring", client_name: "Glow Co", cost: 900, contact_email: "host@example.test",
  locations: [{ location_id: UUID, name: "Loft", neighborhood: "Mission", rental_type: "house", rooms: ["Kitchen"], attributes: ["Bright"], listing_url: "https://leak.example",
    photos: [{ id: UUID, caption: "Front", path: "loc/1.jpg", storage_path: "loc/1.jpg" }] }],
};
const SHEET = {
  status: "ok", call_time: "08:00:00", wrap_time_estimate: "5 pm", general_notes: "Bring ID", shoot_date: "2026-12-01", shoot_location: "Loft", client_name: "Glow Co",
  talent: [{ name: "Ada", phone: "555-0100", email: "ada@example.test", notes: "private" }],
  location: { name: "Loft", wifi_password: "pw", cost: 900, notes: "private" },
  schedule: [{ id: UUID, label: "Setup", start_time: "08:00", end_time: "09:00", talent: [{ name: "Ada", phone: "x" }], crew: [{ id: UUID, name: "Bo", rate_notes: "private" }] }],
  crew: [{ id: UUID, name: "Bo", role: "DP", phone: "555-0101", email: "bo@example.test", rate_notes: "private" }],
};

interface FakeOpts {
  /** Status the board functions answer for the token. */
  status?: string;
  voteAnswer?: string;
  /** Rate limit keys (prefix) that answer false. */
  limited?: string[];
  people?: unknown[];
}

function fakeDb(opts: FakeOpts = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const signed: string[] = [];
  const db = {
    calls,
    signed,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "public_link_rate_hit") {
        const key = String(args.p_key);
        const blocked = (opts.limited ?? []).some((p) => key.startsWith(p));
        return Promise.resolve({ data: !blocked, error: null });
      }
      if (name === "public_board_get") {
        const status = opts.status ?? "ok";
        if (status !== "ok") return Promise.resolve({ data: { status }, error: null });
        return Promise.resolve({
          data: { status: "ok", client_name: "Glow Co", expires_at: "2030-01-01T00:00:00Z", people: opts.people ?? [] },
          error: null,
        });
      }
      if (name === "public_location_board_get" || name === "public_call_sheet_get") {
        const status = opts.status ?? "ok";
        if (status !== "ok") return Promise.resolve({ data: { status }, error: null });
        return Promise.resolve({ data: name === "public_call_sheet_get" ? SHEET : LOCATIONS, error: null });
      }
      if (name === "public_board_vote") return Promise.resolve({ data: opts.voteAnswer ?? "ok", error: null });
      if (name === "public_board_media") {
        return Promise.resolve({ data: { status: "ok", bucket: "creator-family-pet-photos", path: "c1/p1.jpg" }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrls(paths: string[]) {
            signed.push(...paths.map((p) => `${bucket}/${p}`));
            return Promise.resolve({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${bucket}/${p}`, error: null })), error: null });
          },
        };
      },
    },
  };
  return db;
}

function req(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://example.test/functions/v1/public-link", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

Deno.test("no token is 404 and counted as a miss", async () => {
  const db = fakeDb();
  const res = await mod.handler(req({ type: "approval", action: "get" }), db);
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "not_found");
  assert(!db.calls.some((c) => c.name === "public_board_get"));
});

Deno.test("a malformed token never reaches the database lookup", async () => {
  const db = fakeDb();
  const res = await mod.handler(req({ type: "approval", action: "get", token: "short" }), db);
  assertEquals(res.status, 404);
  assert(!db.calls.some((c) => c.name === "public_board_get"));
});

Deno.test("the database is asked for the hash, never the token", async () => {
  const db = fakeDb();
  await mod.handler(req({ type: "approval", action: "get", token: TOKEN }), db);
  const call = db.calls.find((c) => c.name === "public_board_get")!;
  assertEquals(call.args.p_token_hash, await sha256Hex(TOKEN));
  assert(!JSON.stringify(db.calls).includes(TOKEN));
  assertEquals(call.args.p_board_type, "creators");
});

Deno.test("wrong token (unknown to the database) is 404", async () => {
  const res = await mod.handler(req({ type: "casting", action: "get", token: TOKEN }), fakeDb({ status: "not_found" }));
  assertEquals(res.status, 404);
});

Deno.test("expired and revoked answer 410 with no board data", async () => {
  for (const status of ["expired", "revoked"]) {
    const res = await mod.handler(req({ type: "approval", action: "get", token: TOKEN }), fakeDb({ status }));
    assertEquals(res.status, 410);
    assertEquals(await res.json(), { error: status });
  }
});

Deno.test("an unknown type or action is 400", async () => {
  assertEquals((await mod.handler(req({ type: "nope", action: "get", token: TOKEN }), fakeDb())).status, 400);
  assertEquals((await mod.handler(req({ type: "approval", action: "delete", token: TOKEN }), fakeDb())).status, 400);
});

Deno.test("get returns only the allowed keys and signs media, hiding storage paths", async () => {
  const db = fakeDb({
    people: [{
      assignment_id: UUID, name: "Avery", email: "leak@example.test", vote: "up",
      videos: [{ id: UUID, title: "Hello", format: "skit", video_path: "c1/v.mp4", thumbnail_path: "c1/t.jpg", storage_path: "x" }],
      family_pet_photos: [{ id: UUID, category: "pet", caption: null, storage_path: "secret/path.jpg" }],
      filming_location_photos: [],
    }],
  });
  const res = await mod.handler(req({ type: "approval", action: "get", token: TOKEN }), db);
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(!text.includes("leak@example.test"));
  assert(!text.includes("secret/path.jpg"));
  assert(!text.includes("storage_path"));
  assert(!text.includes("video_path"));
  const body = JSON.parse(text);
  assertEquals(body.people[0].videos[0].url, "https://signed.example/creator-videos/c1/v.mp4");
  assertEquals(res.headers.get("cache-control"), "no-store");
});

Deno.test("vote: success, cross-link refused, bad value refused", async () => {
  const ok = await mod.handler(req({ type: "approval", action: "vote", token: TOKEN, assignment_id: UUID, vote: "up", voted_by: "Sam" }), fakeDb());
  assertEquals(ok.status, 200);
  const cross = await mod.handler(req({ type: "approval", action: "vote", token: TOKEN, assignment_id: UUID, vote: "up" }), fakeDb({ voteAnswer: "invalid" }));
  assertEquals(cross.status, 400);
  const db = fakeDb();
  const bad = await mod.handler(req({ type: "approval", action: "vote", token: TOKEN, assignment_id: "not-a-uuid", vote: "up" }), db);
  assertEquals(bad.status, 400);
  const noWrite = db.calls.find((c) => c.name === "public_board_vote");
  assertEquals(noWrite?.args.p_assignment_id, null);
});

Deno.test("vote on a revoked link is 410 and an unknown one 404", async () => {
  assertEquals((await mod.handler(req({ type: "casting", action: "vote", token: TOKEN, assignment_id: UUID, vote: "down" }), fakeDb({ voteAnswer: "revoked" }))).status, 410);
  assertEquals((await mod.handler(req({ type: "casting", action: "vote", token: TOKEN, assignment_id: UUID, vote: "down" }), fakeDb({ voteAnswer: "not_found" }))).status, 404);
});

Deno.test("photo returns a signed address for a photo on the board", async () => {
  const res = await mod.handler(req({ type: "approval", action: "photo", token: TOKEN, kind: "photo", id: UUID }), fakeDb());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).url, "https://signed.example/creator-family-pet-photos/c1/p1.jpg");
});

Deno.test("an oversized payload is 413", async () => {
  const big = JSON.stringify({ type: "approval", action: "vote", token: TOKEN, voted_by: "x".repeat(20000) });
  const res = await mod.handler(req(big), fakeDb());
  assertEquals(res.status, 413);
});

Deno.test("bad json is 400 and GET is 405", async () => {
  assertEquals((await mod.handler(req("{nope"), fakeDb())).status, 400);
  assertEquals((await mod.handler(new Request("https://example.test/", { method: "GET" }), fakeDb())).status, 405);
});

Deno.test("rate limited by address, by token and for writes: 429 before any lookup", async () => {
  for (const prefix of ["ip:", "tok:", "write:"]) {
    const db = fakeDb({ limited: [prefix] });
    const res = await mod.handler(req({ type: "approval", action: "vote", token: TOKEN, assignment_id: UUID, vote: "up" }), db);
    assertEquals(res.status, 429, prefix);
    assert(res.headers.get("retry-after"));
    assert(!db.calls.some((c) => c.name === "public_board_vote"));
  }
});

Deno.test("an address that keeps missing is blocked", async () => {
  const db = fakeDb({ limited: ["miss:"] });
  const res = await mod.handler(req({ type: "approval", action: "get", token: TOKEN }), db);
  assertEquals(res.status, 429);
});

Deno.test("a rate limit database error fails closed", async () => {
  const db = fakeDb();
  db.rpc = () => Promise.resolve({ data: null, error: { message: "down" } });
  const res = await mod.handler(req({ type: "approval", action: "get", token: TOKEN }), db);
  assertEquals(res.status, 429);
});

Deno.test("location board: allowed keys only, photos signed, no storage path or cost", async () => {
  const db = fakeDb();
  const res = await mod.handler(req({ type: "location", action: "get", token: TOKEN }), db);
  assertEquals(res.status, 200);
  const text = await res.text();
  for (const bad of ["cost", "host@example.test", "leak.example", "storage_path", "\"path\""]) assert(!text.includes(bad), bad);
  assertEquals(JSON.parse(text).locations[0].photos[0].url, "https://signed.example/location-photos/loc/1.jpg");
  assertEquals(db.calls.find((c) => c.name === "public_location_board_get")!.args.p_token_hash, await sha256Hex(TOKEN));
});

Deno.test("call sheet: explicit keys only, no private notes or rates", async () => {
  const res = await mod.handler(req({ type: "call-sheet", action: "get", token: TOKEN }), fakeDb());
  assertEquals(res.status, 200);
  const text = await res.text();
  for (const bad of ["private", "cost", "\"notes\":\"private"]) assert(!text.includes(bad), bad);
  const body = JSON.parse(text);
  assertEquals(body.crew[0].phone, "555-0101");
  assertEquals(body.schedule[0].talent[0], { name: "Ada" });
});

Deno.test("location and call sheet: unknown, revoked, expired, wrong token shape", async () => {
  for (const type of ["location", "call-sheet"]) {
    assertEquals((await mod.handler(req({ type, action: "get", token: TOKEN }), fakeDb({ status: "not_found" }))).status, 404);
    assertEquals((await mod.handler(req({ type, action: "get", token: TOKEN }), fakeDb({ status: "revoked" }))).status, 410);
    assertEquals((await mod.handler(req({ type, action: "get", token: TOKEN }), fakeDb({ status: "expired" }))).status, 410);
    assertEquals((await mod.handler(req({ type, action: "get" }), fakeDb())).status, 404);
    assertEquals((await mod.handler(req({ type, action: "get", token: "x".repeat(200) }), fakeDb())).status, 404);
  }
});

Deno.test("location and call sheet are read only: vote and photo are 400", async () => {
  for (const type of ["location", "call-sheet"]) {
    for (const action of ["vote", "photo"]) {
      const db = fakeDb();
      assertEquals((await mod.handler(req({ type, action, token: TOKEN, assignment_id: UUID, vote: "up" }), db)).status, 400);
      assert(!db.calls.some((c) => c.name.startsWith("public_board_")));
    }
  }
});

Deno.test("location and call sheet are rate limited and capped", async () => {
  for (const type of ["location", "call-sheet"]) {
    assertEquals((await mod.handler(req({ type, action: "get", token: TOKEN }), fakeDb({ limited: ["ip:"] }))).status, 429);
    assertEquals((await mod.handler(req({ type, action: "get", token: TOKEN }), fakeDb({ limited: ["tok:"] }))).status, 429);
    assertEquals((await mod.handler(req(JSON.stringify({ type, action: "get", token: TOKEN, pad: "x".repeat(20000) })), fakeDb())).status, 413);
  }
});

Deno.test("a database error is a 500 with no detail", async () => {
  const db = fakeDb();
  const orig = db.rpc.bind(db);
  db.rpc = (name: string, args: Record<string, unknown>) => (name === "public_call_sheet_get" ? Promise.resolve({ data: null, error: { message: "secret detail" } }) : orig(name, args));
  const res = await mod.handler(req({ type: "call-sheet", action: "get", token: TOKEN }), db);
  assertEquals(res.status, 500);
  assert(!(await res.text()).includes("secret detail"));
});
