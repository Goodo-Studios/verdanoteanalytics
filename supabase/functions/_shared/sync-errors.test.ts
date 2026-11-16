import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { networkErrorMessage, serializeApiErrors } from "./sync-errors.ts";

// Fake token shaped like a Meta user token. Not a real credential.
const FAKE = "EAAB" + "x".repeat(40);
const URL_WITH_TOKEN = `https://graph.facebook.com/v21.0/act_1/insights?limit=500&access_token=${FAKE}&after=XYZ`;

Deno.test("networkErrorMessage removes the token from a fetch error that includes the URL", () => {
  const err = new TypeError(`error sending request for url (${URL_WITH_TOKEN}): connection reset`);
  const msg = networkErrorMessage(err);
  assert(msg.startsWith("Network error: "));
  assertFalse(msg.includes(FAKE));
  assert(msg.includes("after=XYZ"));
});

Deno.test("serializeApiErrors redacts new entries and keeps valid JSON", () => {
  const out = serializeApiErrors(null, [{ timestamp: "t", message: `failed ${URL_WITH_TOKEN}` }]);
  assertFalse(out.includes(FAKE));
  const parsed = JSON.parse(out);
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].timestamp, "t");
});

Deno.test("serializeApiErrors also cleans entries stored before the fix", () => {
  const legacy = JSON.stringify([{ timestamp: "old", message: `Network error: TypeError: ${URL_WITH_TOKEN}` }]);
  const out = serializeApiErrors(legacy, [{ timestamp: "new", message: "Rate limited" }]);
  assertFalse(out.includes(FAKE));
  const parsed = JSON.parse(out);
  assertEquals(parsed.map((e: { timestamp: string }) => e.timestamp), ["old", "new"]);
});

Deno.test("serializeApiErrors keeps a non-JSON stored value instead of dropping it", () => {
  const out = serializeApiErrors(`plain text ${URL_WITH_TOKEN}`, []);
  assertFalse(out.includes(FAKE));
  assertEquals(JSON.parse(out).length, 1);
});
