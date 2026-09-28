import assert from "node:assert/strict";
import test from "node:test";
import { missingE2eVariables } from "./require-e2e-env.mjs";

const complete = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "anon-key",
  PLAYWRIGHT_TEST_EMAIL: "staff@example.com",
  PLAYWRIGHT_TEST_PASSWORD: "staff-password",
  PLAYWRIGHT_CLIENT_EMAIL: "client@example.com",
  PLAYWRIGHT_CLIENT_PASSWORD: "client-password",
};

test("complete E2E environment passes validation", () => {
  assert.deepEqual(missingE2eVariables(complete), []);
});

test("missing and blank E2E variables are reported", () => {
  const env = { ...complete, PLAYWRIGHT_TEST_PASSWORD: " ", PLAYWRIGHT_CLIENT_EMAIL: undefined };
  assert.deepEqual(missingE2eVariables(env), [
    "PLAYWRIGHT_TEST_PASSWORD",
    "PLAYWRIGHT_CLIENT_EMAIL",
  ]);
});
