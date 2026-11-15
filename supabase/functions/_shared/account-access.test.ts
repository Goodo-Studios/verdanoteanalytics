import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasAccountAccess } from "./account-access.ts";

type Link = { user_id: string; account_id: string };

// Minimal fake that mimics PostgREST: select("1") is an invalid column and errors,
// select("account_id") returns the linked row when one exists.
function fakeDb(role: string, links: Link[]) {
  return {
    rpc: (_name: string, _args: unknown) => Promise.resolve({ data: role, error: null }),
    from: (_table: string) => {
      const filters: Record<string, string> = {};
      let cols = "";
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: (c: string) => { cols = c; return b; },
        eq: (k: string, v: string) => { filters[k] = v; return b; },
        maybeSingle: () => {
          if (cols !== "account_id") {
            return Promise.resolve({ data: null, error: { message: `column ${cols} does not exist` } });
          }
          const row = links.find((l) => l.user_id === filters.user_id && l.account_id === filters.account_id);
          return Promise.resolve({ data: row ? { account_id: row.account_id } : null, error: null });
        },
      };
      return b;
    },
  };
}

Deno.test("client with a linked account is allowed", async () => {
  const db = fakeDb("client", [{ user_id: "u1", account_id: "a1" }]);
  assertEquals(await hasAccountAccess(db, "u1", "a1"), true);
});

Deno.test("client without a link to the account is denied", async () => {
  const db = fakeDb("client", [{ user_id: "u1", account_id: "a1" }]);
  assertEquals(await hasAccountAccess(db, "u1", "a2"), false);
});

Deno.test("staff are allowed without a link", async () => {
  assertEquals(await hasAccountAccess(fakeDb("employee", []), "u9", "a1"), true);
  assertEquals(await hasAccountAccess(fakeDb("builder", []), "u9", "a1"), true);
});
