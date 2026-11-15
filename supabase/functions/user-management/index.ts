import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type DashboardRoleMapping, mapDashboardRoleWith, type RoleMappingRow } from "../_shared/dashboard-role-map.ts";

// A dashboard role is turned into a Verdanote role by the mapping in public.staff_role_mappings
// (step 5d, shown on the Team page): admin to builder, viewer to client, any other staff role to
// employee (owner decision 2026-11-11).
interface MappingReader {
  from(table: string): {
    select(columns: string): PromiseLike<{ data: RoleMappingRow[] | null; error: unknown }>;
  };
}
async function resolveDashboardRole(supabase: MappingReader, dashboardRole: unknown): Promise<DashboardRoleMapping> {
  const { data, error } = await supabase
    .from("staff_role_mappings")
    .select("dashboard_role, verdanote_role");
  if (error) return { ok: false, error: "The role mapping could not be read." };
  return mapDashboardRoleWith(data, dashboardRole);
}


export interface Deps {
  createClient?: typeof createClient;
}

// Shown for every unexpected failure; the detail is logged, never returned.
const GENERIC_ERROR = "The request could not be completed. Try again.";
const LAST_BUILDER_ERROR = "This is the last builder. Make another login a builder first.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ROLES = ["builder", "employee", "client"] as const;
export const MIN_PASSWORD_LENGTH = 8;
const MAX_ACCOUNT_LINKS = 500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns an error message when the role or account_ids are not usable, else null. */
export function validateRoleAndAccounts(role: unknown, accountIds: unknown): string | null {
  if (role !== undefined && role !== null && !(ROLES as readonly string[]).includes(role as string)) {
    return `role must be one of ${ROLES.join(", ")}`;
  }
  if (accountIds !== undefined) {
    if (!Array.isArray(accountIds) || accountIds.length > MAX_ACCOUNT_LINKS) {
      return "account_ids must be an array of account ids";
    }
    if (accountIds.some((a) => typeof a !== "string" || a.trim() === "")) {
      return "account_ids must be an array of non-empty strings";
    }
  }
  return null;
}

/** Throws when a database call came back with an error, so the catch below answers 500. */
function must(label: string, result: { error?: { message?: string } | null }): void {
  if (result.error) throw new Error(`${label}: ${result.error.message ?? "failed"}`);
}

/**
 * True when changing or removing this login would leave the app with no builder: the login holds
 * the builder role and no other login does. Reads fail closed (an error throws, so nothing changes).
 */
async function isLastBuilder(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<boolean> {
  const own = await supabase.from("user_roles").select("role").eq("user_id", userId);
  must("user_roles read", own);
  if (!((own.data ?? []) as { role?: string }[]).some((r) => r.role === "builder")) return false;
  const builders = await supabase.from("user_roles").select("user_id").eq("role", "builder");
  must("builders read", builders);
  return !((builders.data ?? []) as { user_id?: string }[]).some((r) => r.user_id !== userId);
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = (deps.createClient ?? createClient)(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Verify caller is builder
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user: caller } } = await supabase.auth.getUser(token);
  if (!caller) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check builder role. Fetch ALL role rows (a user may hold more than one) —
  // .single() throws for >1 row, which would spuriously 500/lock out a
  // multi-role builder. Mirrors settings/reports/matrix.
  const { data: callerRoles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id);

  const isBuilder = (callerRoles ?? []).some((r: { role?: string }) => r.role === "builder");
  if (!isBuilder) {
    return new Response(JSON.stringify({ error: "Forbidden: builder only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/user-management\/?/, "").replace(/\/$/, "");

  try {
    // GET /user-management — list all users with roles and accounts
    if (req.method === "GET" && !path) {
      const { data: profiles } = await supabase.from("profiles").select("*").order("created_at");
      const { data: roles } = await supabase.from("user_roles").select("*");
      const { data: userAccounts } = await supabase.from("user_accounts").select("*");

      const users = (profiles || []).map((p: any) => ({
        ...p,
        role: (roles || []).find((r: any) => r.user_id === p.user_id)?.role || null,
        account_ids: (userAccounts || []).filter((ua: any) => ua.user_id === p.user_id).map((ua: any) => ua.account_id),
      }));

      return new Response(JSON.stringify(users), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /user-management — create user
    if (req.method === "POST" && !path) {
      const { email, password, role: requestedRole, dashboard_role, display_name, account_ids } = await req.json();

      // A staff member coming from the old dashboard can be created by their
      // dashboard role, through the mapping in staff_role_mappings (step 5d).
      let role = requestedRole;
      if (!role && dashboard_role) {
        const mapped = await resolveDashboardRole(supabase, dashboard_role);
        if (!mapped.ok) {
          return new Response(JSON.stringify({ error: mapped.error }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        role = mapped.role;
      }

      if (!email || !password || !role) {
        return new Response(JSON.stringify({ error: "email, password, and role are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (typeof email !== "string" || !EMAIL.test(email)) return json({ error: "email is not valid" }, 400);
      if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
        return json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      }
      const invalid = validateRoleAndAccounts(role, account_ids);
      if (invalid) return json({ error: invalid }, 400);

      // Create auth user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createError) throw createError;
      const userId = newUser.user.id;

      // Everything below is checked. If any step fails the login just created is removed again,
      // so a failed create never leaves a login with no role or the wrong accounts.
      try {
        // Update display name if provided
        if (display_name) {
          must("profiles", await supabase.from("profiles").update({ display_name }).eq("user_id", userId));
        }

        // Set role
        must("user_roles insert", await supabase.from("user_roles").insert({ user_id: userId, role }));

        // Link accounts (for clients)
        if (account_ids && account_ids.length > 0) {
          const links = account_ids.map((account_id: string) => ({ user_id: userId, account_id }));
          must("user_accounts insert", await supabase.from("user_accounts").insert(links));
        }
      } catch (setupError) {
        try {
          await supabase.auth.admin.deleteUser(userId);
        } catch (cleanup) {
          console.error("User management could not remove the half-made login:", cleanup);
        }
        throw setupError;
      }

      return new Response(JSON.stringify({ success: true, user_id: userId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PUT /user-management/:userId — update user role/accounts
    if (req.method === "PUT" && path) {
      const userId = path;
      const { role: requestedRole, dashboard_role, account_ids, display_name } = await req.json();

      let role = requestedRole;
      if (!role && dashboard_role) {
        const mapped = await resolveDashboardRole(supabase, dashboard_role);
        if (!mapped.ok) {
          return new Response(JSON.stringify({ error: mapped.error }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        role = mapped.role;
      }

      const invalidPut = validateRoleAndAccounts(role, account_ids);
      if (invalidPut) return json({ error: invalidPut }, 400);

      // The last builder cannot be demoted: nobody would be left to manage logins.
      if (role && role !== "builder" && await isLastBuilder(supabase, userId)) {
        return json({ error: LAST_BUILDER_ERROR }, 409);
      }

      if (display_name !== undefined) {
        must("profiles", await supabase.from("profiles").update({ display_name }).eq("user_id", userId));
      }

      if (role) {
        // Give the new role first, then drop the others, so a failure never leaves the login with
        // no role. A role it already holds answers 23505 and is fine.
        const added = await supabase.from("user_roles").insert({ user_id: userId, role });
        if (added.error && added.error.code !== "23505") must("user_roles insert", added);
        must("user_roles delete", await supabase.from("user_roles").delete().eq("user_id", userId).neq("role", role));
      }

      if (account_ids !== undefined) {
        // Add the missing links first, then remove the ones no longer wanted. A failure part way
        // leaves a superset of the wanted links, never an empty set (the old delete-all then
        // insert-all left the login with no accounts if the insert failed).
        const wanted = [...new Set<string>(account_ids)];
        const existing = await supabase.from("user_accounts").select("account_id").eq("user_id", userId);
        must("user_accounts read", existing);
        const have = new Set(((existing.data ?? []) as { account_id: string }[]).map((r) => r.account_id));
        const toAdd = wanted.filter((a) => !have.has(a));
        const toRemove = [...have].filter((a) => !wanted.includes(a));
        if (toAdd.length > 0) {
          must(
            "user_accounts insert",
            await supabase.from("user_accounts").insert(toAdd.map((account_id) => ({ user_id: userId, account_id }))),
          );
        }
        if (toRemove.length > 0) {
          must("user_accounts delete", await supabase.from("user_accounts").delete().eq("user_id", userId).in("account_id", toRemove));
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE /user-management/:userId — delete user
    if (req.method === "DELETE" && path) {
      const userId = path;
      if (await isLastBuilder(supabase, userId)) {
        return json({ error: LAST_BUILDER_ERROR }, 409);
      }
      must("deleteUser", await supabase.auth.admin.deleteUser(userId));
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("User management error:", e);
    return json({ error: GENERIC_ERROR }, 500);
  }
}

// Tests import the handler with USER_MANAGEMENT_NO_SERVE set.
if (!Deno.env.get("USER_MANAGEMENT_NO_SERVE")) {
  serve((req) => handler(req));
}
