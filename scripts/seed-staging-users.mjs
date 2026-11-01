#!/usr/bin/env node
// Create made-up staff and client logins in the STAGING Supabase project.
//
// Refuses to run against the production project. Idempotent: re-running keeps the
// same users, resets their password to STAGING_TEST_PASSWORD and re-links roles.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_SERVICE_ROLE_KEY,STAGING_TEST_PASSWORD \
//     -- node scripts/seed-staging-users.mjs
//
// Run scripts/seed-demo-account.mjs first (against staging) so the demo ad account
// exists; the test client is linked to it.
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "gwyxaqoaldnaavkjqquv";
const url = process.env.STAGING_SUPABASE_URL;
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.STAGING_TEST_PASSWORD;
if (!url || !key || !password) {
  console.error("Set STAGING_SUPABASE_URL, STAGING_SUPABASE_SERVICE_ROLE_KEY and STAGING_TEST_PASSWORD.");
  process.exit(1);
}
if (url.includes(PROD_REF)) {
  console.error("Refusing to run: that URL is the production project.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const DEMO_ACCOUNT = "act_demo_glowdrip";

const USERS = [
  { email: "builder@staging.verdanote.test", name: "Test Builder (staff)", role: "builder", accounts: [] },
  { email: "employee@staging.verdanote.test", name: "Test Employee (staff)", role: "employee", accounts: [] },
  { email: "client-a@staging.verdanote.test", name: "Test Client A", role: "client", accounts: [DEMO_ACCOUNT] },
  { email: "client-b@staging.verdanote.test", name: "Test Client B (no accounts)", role: "client", accounts: [] },
];

async function findUser(email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

for (const u of USERS) {
  let user = await findUser(u.email);
  if (user) {
    const { error } = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) throw error;
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: u.name },
    });
    if (error) throw error;
    user = data.user;
  }

  const prof = await db
    .from("profiles")
    .upsert({ user_id: user.id, email: u.email, display_name: u.name }, { onConflict: "user_id" });
  if (prof.error) throw prof.error;

  // One role per test user.
  const del = await db.from("user_roles").delete().eq("user_id", user.id);
  if (del.error) throw del.error;
  const role = await db.from("user_roles").insert({ user_id: user.id, role: u.role });
  if (role.error) throw role.error;

  const delAcc = await db.from("user_accounts").delete().eq("user_id", user.id);
  if (delAcc.error) throw delAcc.error;
  for (const accountId of u.accounts) {
    const link = await db.from("user_accounts").insert({ user_id: user.id, account_id: accountId });
    if (link.error) throw link.error;
  }
  console.log(`ok  ${u.role.padEnd(8)} ${u.email}`);
}
