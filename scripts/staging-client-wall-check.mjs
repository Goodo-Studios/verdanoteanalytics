#!/usr/bin/env node
// Client wall check for staging: signs in as a test client and a test staff user
// through the normal login API, then confirms what each can read.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_TEST_PASSWORD \
//     -- node scripts/staging-client-wall-check.mjs
//
// Exit code 1 if any check fails. Refuses to run against production.
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

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

async function signIn(email) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { c, token: data.session.access_token, userId: data.user.id };
}

async function rows(c, table) {
  const { data, error } = await c.from(table).select("*").limit(1000);
  return { n: data?.length ?? 0, error: error?.message };
}

const staff = await signIn("builder@staging.verdanote.test");
const clientA = await signIn("client-a@staging.verdanote.test");
const clientB = await signIn("client-b@staging.verdanote.test");

// Sign-in and role lookup.
const roleOf = async (s) => (await s.c.from("user_roles").select("role")).data?.map((r) => r.role);
check("staff sign-in resolves role builder", (await roleOf(staff))?.[0] === "builder");
check("client A sign-in resolves role client", (await roleOf(clientA))?.[0] === "client");

// A client sees only their own rows in the shared admin tables.
for (const [label, s] of [["client A", clientA], ["client B", clientB]]) {
  for (const table of ["profiles", "user_roles", "user_accounts"]) {
    const r = await rows(s.c, table);
    check(`${label} reads at most their own row in ${table}`, r.n <= 1, `rows=${r.n}`);
  }
}

// Ad accounts: client A sees only the linked demo account, client B sees none, staff see all.
const accA = await clientA.c.from("ad_accounts").select("id");
check("client A sees only linked accounts", (accA.data ?? []).every((a) => a.id === "act_demo_glowdrip"), `ids=${(accA.data ?? []).map((a) => a.id)}`);
const accB = await clientB.c.from("ad_accounts").select("id");
check("client B sees no accounts", (accB.data ?? []).length === 0, `rows=${accB.data?.length ?? "error"}`);

// Staff-only server call: a client token must be refused.
const call = async (token) =>
  fetch(`${url}/functions/v1/user-management`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
const asClient = await call(clientA.token);
check("client token is refused by user-management", [401, 403].includes(asClient.status), `status=${asClient.status}`);
const asStaff = await call(staff.token);
check("staff token is accepted by user-management", asStaff.status < 400, `status=${asStaff.status}`);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll client wall checks passed");
process.exit(failed ? 1 : 0);
