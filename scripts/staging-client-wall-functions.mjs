#!/usr/bin/env node
// Client wall check for server functions, against STAGING only.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_TEST_PASSWORD \
//     -- node scripts/staging-client-wall-functions.mjs
//
// Signs in as the test client and calls every function listed in
// supabase/function-access.json that must refuse clients (class staff, service,
// secret). Each call has to come back 401 or 403. A function that is missing,
// broken (404, 5xx) or lets the client through fails the run. Also checks:
//   - a client linked to the demo account cannot read it through the
//     account-scoped functions that take an account id, when signed in as the
//     client with no linked accounts (client B);
//   - positive controls, so a gate that refuses everybody cannot pass: the
//     builder is accepted by builder functions, the employee by employee
//     functions and refused by builder-only ones.
//
// Exit code 1 if anything fails. Refuses to run against production.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "gwyxaqoaldnaavkjqquv";
const url = process.env.STAGING_SUPABASE_URL;
const anon = process.env.STAGING_SUPABASE_ANON_KEY;
const password = process.env.STAGING_TEST_PASSWORD;
if (!url || !anon || !password) {
  console.error("Set STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY and STAGING_TEST_PASSWORD.");
  process.exit(1);
}
if (url.includes(PROD_REF)) {
  console.error("Refusing to run: that URL is the production project.");
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(new URL("../supabase/function-access.json", import.meta.url), "utf8"),
).functions;

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

async function signIn(email) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return data.session.access_token;
}

async function call(name, token, { method = "POST", body = {}, query = "" } = {}) {
  const res = await fetch(`${url}/functions/v1/${name}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

const clientA = await signIn("client-a@staging.verdanote.test");
const clientB = await signIn("client-b@staging.verdanote.test");
const builder = await signIn("builder@staging.verdanote.test");
const employee = await signIn("employee@staging.verdanote.test");

const refused = (s) => s === 401 || s === 403;

// 1. Every function that must refuse clients.
const mustRefuse = Object.entries(manifest).filter(([, v]) => ["staff", "service", "secret"].includes(v.class));
for (const [name, entry] of mustRefuse) {
  const status = await call(name, clientA, entry.probe ?? {});
  // Secret and signature gated functions reject a request with no valid secret or
  // signature as 400 (malformed) or 401. Either way no work is done for the caller.
  const ok = entry.class === "secret" ? refused(status) || status === 400 : refused(status);
  check(`client token refused by ${name} (${entry.class})`, ok, `status=${status}`);
}

// 2. Account-scoped functions: a client with no linked accounts is refused for the demo account.
for (const [name, entry] of Object.entries(manifest)) {
  if (!entry.crossAccountProbe) continue;
  const status = await call(name, clientB, entry.crossAccountProbe);
  check(`client B refused demo account by ${name}`, status === 403, `status=${status}`);
}

// 3. Positive controls on read-only calls.
const controls = [
  ["builder accepted by user-management", "user-management", builder, { method: "GET" }, (s) => s < 400],
  ["builder accepted by settings", "settings", builder, { method: "GET" }, (s) => s < 400],
  ["employee accepted by accounts", "accounts", employee, { method: "GET" }, (s) => s < 400],
  ["employee refused by user-management (builder only)", "user-management", employee, { method: "GET" }, refused],
  ["employee refused by settings (builder only)", "settings", employee, { method: "GET" }, refused],
  ["client A accepted by accounts (its own list)", "accounts", clientA, { method: "GET" }, (s) => s < 400],
];
for (const [label, name, token, opts, ok] of controls) {
  const status = await call(name, token, opts);
  check(label, ok(status), `status=${status}`);
}

// 4. Ad code counter (Ad Name Generator): clients are refused by peek_ad_code and
//    claim_ad_code; builder and employee may peek. Nobody claims here, so no staging
//    code is spent.
const rpcStatus = async (name, token) => {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anon, "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  return { status: res.status, text };
};
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const fn of ["peek_ad_code", "claim_ad_code"]) {
    const r = await rpcStatus(fn, s);
    check(`${label} refused by ${fn}`, refused(r.status), `status=${r.status}`);
  }
}
for (const [label, s] of [["builder", builder], ["employee", employee]]) {
  const r = await rpcStatus("peek_ad_code", s);
  check(`${label} can peek the next ad code`, r.status === 200 && Number(r.text) > 0, `status=${r.status}`);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll server function wall checks passed");
process.exit(failed ? 1 : 0);
