#!/usr/bin/env node
// Client wall check for database functions, against STAGING only.
//
//   hq secrets exec --company goodo-studios \
//     --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_SUPABASE_SERVICE_ROLE_KEY,STAGING_TEST_PASSWORD \
//     -- node scripts/staging-function-grants-check.mjs
//
// Lists every function the REST API exposes (the service role sees all of them), then
// calls each one as
//   - anon: the public key with no login, and
//   - client B: a signed-in client with no linked accounts,
// with inert arguments (an account id that does not exist, empty payloads, limit 0).
// Each call has to come back refused with permission denied (HTTP 401 or 403, code
// 42501). A function that answers, errors for another reason, or is missing fails the run.
//
// Functions that are open on purpose are listed in OPEN_BY_DESIGN with the reason. They
// have to match supabase/tests/security_definer_grants_test.sql. Positive controls prove
// the lock-down did not break the paths that must keep working: service_role can still
// call a locked function, the builder gets the agency summary, and client A still reads
// its own account's period metrics.
//
// Exit code 1 if anything fails. Refuses to run against production.
const PROD_REF = "gwyxaqoaldnaavkjqquv";
const url = process.env.STAGING_SUPABASE_URL;
const anon = process.env.STAGING_SUPABASE_ANON_KEY;
const service = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.STAGING_TEST_PASSWORD;
if (!url || !anon || !service || !password) {
  console.error(
    "Set STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY and STAGING_TEST_PASSWORD.",
  );
  process.exit(1);
}
if (url.includes(PROD_REF)) {
  console.error("Refusing to run: that URL is the production project.");
  process.exit(1);
}

// Open on purpose. `anon` = also callable with no login.
const OPEN_BY_DESIGN = {
  // Row rules run as the caller, so the caller needs EXECUTE.
  has_role: { anon: false, why: "row rules" },
  get_user_role: { anon: false, why: "row rules and the browser" },
  get_user_account_ids: { anon: false, why: "row rules" },
  get_user_client_slugs: { anon: false, why: "row rules, answers only for auth.uid()" },
  owns_ad_library_ad: { anon: false, why: "row rules" },
  owns_ad_library_board: { anon: false, why: "row rules" },
  vault_owns_board: { anon: false, why: "row rules" },
  vault_visible_item_ids: { anon: false, why: "row rules, returns the caller's own ids" },
  board_is_public: { anon: true, why: "row rules for public Ad Library boards" },
  ad_is_on_public_board: { anon: true, why: "row rules for public Ad Library boards" },
  // Called through a user-token client by the vault-search edge function.
  match_items: { anon: false, why: "vault-search, reads only the caller's items" },
  // Browser call that stores the key against the caller. Never called here: it would create a key.
  create_api_key: { anon: false, why: "browser, stores the key against auth.uid()" },
};

// Plain helper functions that are not SECURITY DEFINER. They run with the caller's own
// rights, touch no tables and return a value computed from their arguments, so they are
// not a data path. Listed so the refusal check does not flag them.
const NOT_SECURITY_DEFINER = new Set([
  "dashboard_role_to_verdanote_role",
  "goodo_os_role_to_verdanote_role",
  "matrix_creative_type_bucket",
  "stage_follow_up_offset_days",
  "show_limit",
  "show_trgm",
]);

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

const NO_ACCOUNT = "wall_probe_no_such_account";
const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

async function signIn(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${body.error_description ?? res.status}`);
  return body.access_token;
}

async function rpc(name, token, args) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, code: body && typeof body === "object" ? body.code : undefined, body };
}

// Inert argument for one parameter, chosen from its OpenAPI type.
function argFor(name, spec) {
  const t = `${spec.type ?? ""}|${spec.format ?? ""}|${spec.description ?? ""}`.toLowerCase();
  if (spec.type === "array") return [];
  if (/uuid/.test(t)) return ZERO_UUID;
  if (/vector/.test(t) || /embedding/.test(name)) return `[${new Array(1536).fill(0).join(",")}]`;
  if (/timestamp/.test(t)) return "2020-01-01T00:00:00Z";
  if (/\btime\b/.test(spec.format ?? "")) return "00:00:00";
  if (/^p_(from|to|prior_from|prior_to|date_from|date_to)$|(^|_)date$/.test(name) || /date/.test(spec.format ?? "")) return "2020-01-01";
  if (spec.type === "integer" || spec.type === "number" || /numeric|integer|bigint|double/.test(t)) {
    return 0;
  }
  if (spec.type === "boolean") return false;
  if (spec.type === "object" || /json/.test(t)) return /payload/.test(name) ? [] : {};
  if (/account/.test(name)) return NO_ACCOUNT;
  return "wall_probe";
}

// 1. The list of functions and their parameters, from the service role's OpenAPI view.
const spec = await (await fetch(`${url}/rest/v1/`, { headers: { apikey: service, Authorization: `Bearer ${service}` } })).json();
const fns = [];
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  if (!path.startsWith("/rpc/")) continue;
  const name = path.slice(5);
  const bodyParam = (item.post?.parameters ?? []).find((p) => p.in === "body");
  const props = bodyParam?.schema?.properties ?? {};
  const required = new Set(bodyParam?.schema?.required ?? []);
  const args = {};
  for (const [pname, pspec] of Object.entries(props)) if (required.has(pname)) args[pname] = argFor(pname, pspec);
  fns.push({ name, args });
}
fns.sort((a, b) => a.name.localeCompare(b.name));
check("found the functions the REST API exposes (sanity: more than 30)", fns.length > 30, `count=${fns.length}`);

const clientB = await signIn("client-b@staging.verdanote.test");
const clientA = await signIn("client-a@staging.verdanote.test");
const builder = await signIn("builder@staging.verdanote.test");

const denied = (r) => (r.status === 401 || r.status === 403) && r.code === "42501";
const show = (r) => `status=${r.status}${r.code ? " code=" + r.code : ""}`;

// 2. anon and client B are refused by every function that is not open on purpose.
for (const { name, args } of fns) {
  if (NOT_SECURITY_DEFINER.has(name)) continue;
  const open = OPEN_BY_DESIGN[name];
  if (!open?.anon) {
    const r = await rpc(name, anon, args);
    check(`anon refused by ${name}`, denied(r), show(r));
  }
  if (!open) {
    const r = await rpc(name, clientB, args);
    check(`client B refused by ${name}`, denied(r), show(r));
  }
}

// 3. The allow-list entries still exist (a rename would otherwise go unnoticed).
for (const name of Object.keys(OPEN_BY_DESIGN)) {
  check(`open-by-design function exists: ${name}`, fns.some((f) => f.name === name));
}

// 4. Positive controls: the lock-down did not break what must keep working.
const svc = await rpc("get_media_coverage", service, { p_account_id: NO_ACCOUNT });
check("service_role still executes a locked function (get_media_coverage)", svc.status === 200, show(svc));

const agency = await rpc("get_agency_dashboard_summary", builder, {
  p_from: "2020-01-01", p_to: "2030-01-01", p_prior_from: "2019-01-01", p_prior_to: "2019-12-31",
});
check("builder still gets the agency summary", agency.status === 200, show(agency));

const own = await rpc("get_period_metrics", clientA, { p_account_id: "act_demo_glowdrip", p_from: "2020-01-01", p_to: "2030-01-01" });
check("client A still reads its own account's period metrics", own.status === 200, show(own));

const foreign = await rpc("get_period_metrics", clientB, { p_account_id: "act_demo_glowdrip", p_from: "2020-01-01", p_to: "2030-01-01" });
check("client B is refused another account's period metrics (check inside the function)", denied(foreign), show(foreign));

const role = await rpc("get_user_role", clientA, { _user_id: ZERO_UUID });
check("signed-in callers can still run the row-rule helper get_user_role", role.status === 200, show(role));

const slugsB = await rpc("get_user_client_slugs", clientB, {});
check("client B runs get_user_client_slugs and belongs to no client", slugsB.status === 200 && Array.isArray(slugsB.body) && slugsB.body.length === 0, show(slugsB));

const mapB = await rpc("goodo_os_user_role_mapping", clientB, {});
check("client B is refused the Goodo OS role mapping (check inside the function)", denied(mapB), show(mapB));
const mapBuilder = await rpc("goodo_os_user_role_mapping", builder, {});
check("builder reads the Goodo OS role mapping", mapBuilder.status === 200, show(mapBuilder));

// Job queue: the service role can claim (a kind nothing uses, so nothing changes), and a
// builder gets past the staff check in replay_job (refused only because no such job exists).
const claim = await rpc("claim_jobs", service, { p_kinds: ["wall.probe"], p_owner: "wall-check", p_lease_seconds: 1, p_limit: 1 });
check("service_role can claim jobs", claim.status === 200 && Array.isArray(claim.body) && claim.body.length === 0, show(claim));
const replayBuilder = await rpc("replay_job", builder, { p_job_id: ZERO_UUID });
check("builder passes the staff check in replay_job", replayBuilder.code === "55000", show(replayBuilder));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll database function grant checks passed");
process.exit(failed ? 1 : 0);
