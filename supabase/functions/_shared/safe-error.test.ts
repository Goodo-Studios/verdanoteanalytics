import { assertEquals, assertFalse } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { redact, safeErrorResponse } from "./safe-error.ts";

Deno.test("redact strips access_token query values", () => {
  const s = redact("TypeError: error sending request for url (https://graph.facebook.com/v21.0/x?fields=id&access_token=EAAabcdefghijklmnopqrstuv&limit=1)");
  assertFalse(s.includes("EAAabcdefghijklmnopqrstuv"));
  assertEquals(s.includes("access_token=[REDACTED]&limit=1"), true);
});

Deno.test("redact strips bearer tokens and bare Meta tokens, accepts Error", () => {
  assertEquals(redact("Authorization: Bearer abc.def-123"), "Authorization: Bearer [REDACTED]");
  assertFalse(redact(new Error("bad EAAabcdefghijklmnopqrstuvwxyz1")).includes("EAAabc"));
});

Deno.test("safeErrorResponse returns a fixed generic body and never the raw message", async () => {
  const err = new Error("fetch failed https://graph.facebook.com/x?access_token=EAAabcdefghijklmnopqrstuv");
  const res = safeErrorResponse(err, { "X-Test": "1" });
  assertEquals(res.status, 500);
  assertEquals(res.headers.get("X-Test"), "1");
  const body = await res.text();
  assertEquals(JSON.parse(body), { error: "Internal server error" });
  assertFalse(body.includes("EAA"));
});

Deno.test("safeErrorResponse honours status for 401 without echoing detail", async () => {
  const res = safeErrorResponse(new Error("jwt secret detail"), {}, { status: 401 });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
});
