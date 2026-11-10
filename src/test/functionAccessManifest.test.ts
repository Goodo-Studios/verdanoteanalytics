/**
 * Client wall, server functions: static guard.
 *
 * supabase/function-access.json lists the access class of every edge function.
 * This test keeps that list honest:
 *   - every directory in supabase/functions is classified, and nothing else is;
 *   - a function classed "staff" really contains a staff gate in its source;
 *   - a "service" function gates on the service-role key;
 *   - a "secret" function checks a secret, signature or API key;
 *   - an "account-scoped" function either checks account ownership or reads through
 *     the caller's own session so row rules apply (`rls: true`).
 * The live check that a client token is actually refused is
 * scripts/staging-client-wall-functions.mjs (it reads the same file).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Entry = { class: string; minRole?: string; rls?: boolean; note?: string };

const root = process.cwd();
const functionsDir = join(root, "supabase", "functions");
const manifest: Record<string, Entry> = JSON.parse(
  readFileSync(join(root, "supabase", "function-access.json"), "utf8"),
).functions;

const deployed = readdirSync(functionsDir)
  .filter((n) => n !== "_shared" && statSync(join(functionsDir, n)).isDirectory())
  .sort();

const source = (name: string) => readFileSync(join(functionsDir, name, "index.ts"), "utf8");

const STAFF_GATES = [
  /requireStaffOrServiceRole\(/,
  /isStaffUser\(/,
  /roles\.includes\("builder"\)/,
  /from\("user_roles"\)/, // user-management reads the caller's role row directly
];
const SERVICE_GATE = /requireServiceRole\(/;
const SECRET_GATES = [/withApiAuth/, /_SECRET/, /SADIE_API_KEY/, /verifyWebhookItem/, /verifySlackSignature/];
const OWNERSHIP_GATES = [/verifyAccountOwnership\(/, /hasAccountAccess\(/, /resolveCaller\(/, /roles\.includes\("client"\)/, /isStaffUser\(/];

describe("function access manifest", () => {
  it("classifies every function directory and nothing else", () => {
    expect(Object.keys(manifest).sort()).toEqual(deployed);
  });

  it("covers all 76 functions today", () => {
    expect(deployed).toHaveLength(76);
  });

  it("uses only known classes", () => {
    for (const [name, entry] of Object.entries(manifest)) {
      expect(["staff", "service", "secret", "account-scoped", "public"], name).toContain(entry.class);
    }
  });

  describe.each(Object.entries(manifest))("%s", (name, entry) => {
    if (entry.class === "staff") {
      it("contains a staff gate", () => {
        const src = source(name);
        expect(STAFF_GATES.some((g) => g.test(src)), `${name} has no staff gate`).toBe(true);
      });
      if (entry.minRole === "builder") {
        it("is limited to builders in its source", () => {
          expect(/roles\.includes\("builder"\)|\.role !== "builder"|=== "builder"|"builder"/.test(source(name))).toBe(true);
        });
      }
    }
    if (entry.class === "service") {
      it("gates on the service-role key", () => {
        expect(SERVICE_GATE.test(source(name)), `${name} is not behind requireServiceRole`).toBe(true);
      });
    }
    if (entry.class === "secret") {
      it("checks a secret, signature or API key", () => {
        expect(SECRET_GATES.some((g) => g.test(source(name))), `${name} has no secret check`).toBe(true);
      });
    }
    if (entry.class === "public") {
      it("only serves what an account switched on", () => {
        // portfolio is public by slug; it must keep filtering on the opt-in flag.
        expect(/portfolio_enabled/.test(source(name)), `${name} is public and does not check an opt-in flag`).toBe(true);
      });
    }
    if (entry.class === "account-scoped") {
      it("checks account ownership or relies on row rules", () => {
        const ok = entry.rls === true || OWNERSHIP_GATES.some((g) => g.test(source(name))) || /get_user_role/.test(source(name));
        expect(ok, `${name} neither checks ownership nor reads through the caller's session`).toBe(true);
      });
    }
  });

  it("every function that handles the Creative Vault or spends third-party budget is staff-only", () => {
    // Vault tables are staff-only through row rules, but these functions read or write
    // with the service role or call paid APIs, so they need their own gate.
    const mustBeStaff = [
      "vault-ads", "vault-save", "vault-save-creative", "vault-search", "vault-status", "vault-frame-analyze",
      "vault-slack-connect", "vault-slack-import", "vault-share-item", "quick-save", "scrape-ad", "transcribe-ad",
      "account-taxonomy", "creative-library", "creative-media-archive",
    ];
    for (const name of mustBeStaff) expect(manifest[name]?.class, name).toBe("staff");
  });
});
