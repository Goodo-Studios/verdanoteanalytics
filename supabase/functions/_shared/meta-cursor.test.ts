import { assertEquals, assertFalse } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resumeCursor, sanitizeSyncState, stripAccessToken, toStoredCursor } from "./meta-cursor.ts";

const url = "https://graph.facebook.com/v21.0/act_1/insights?fields=a&limit=500&access_token=EAAsecret123&after=XYZ";

Deno.test("stripAccessToken removes the token and keeps other params", () => {
  const out = stripAccessToken(url);
  assertFalse(out.includes("access_token"));
  assertFalse(out.includes("EAAsecret123"));
  assertEquals(new URL(out).searchParams.get("after"), "XYZ");
  assertEquals(new URL(out).searchParams.get("limit"), "500");
});

Deno.test("stripAccessToken is a no-op on token-free URLs and handles non-URLs", () => {
  const clean = "https://graph.facebook.com/v21.0/1/ads?after=A";
  assertEquals(stripAccessToken(clean), clean);
  assertEquals(stripAccessToken("not a url?access_token=abc&x=1"), "not a url?x=1");
});

Deno.test("toStoredCursor passes null through", () => {
  assertEquals(toStoredCursor(null), null);
});

Deno.test("resumeCursor attaches the current token and drops a legacy stored one", () => {
  const out = resumeCursor(url, "NEWTOKEN")!;
  const p = new URL(out).searchParams;
  assertEquals(p.getAll("access_token"), ["NEWTOKEN"]);
  assertEquals(p.get("after"), "XYZ");
  assertFalse(out.includes("EAAsecret123"));
});

Deno.test("resumeCursor works on a token-free cursor and on empty", () => {
  const out = resumeCursor("https://graph.facebook.com/v21.0/1/ads?after=A", "T")!;
  assertEquals(new URL(out).searchParams.get("access_token"), "T");
  assertEquals(resumeCursor(null, "T"), null);
  assertEquals(resumeCursor("", "T"), null);
});

Deno.test("sanitizeSyncState scrubs *_cursor fields, including legacy in-flight state", () => {
  const out = sanitizeSyncState({ campaign_cursor: url, daily_cursor: url, ads_cursor: null, campaign_index: 3 });
  assertFalse(JSON.stringify(out).includes("EAAsecret123"));
  assertEquals(out.campaign_index, 3);
  assertEquals(out.ads_cursor, null);
});
