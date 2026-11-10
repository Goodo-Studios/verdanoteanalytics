import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type Caller, resolveCaller } from "../_shared/internal-auth.ts";

// Invite by email (phase 4, PR 2). A builder invites a staff member or a client login by name and
// email. The login is created with Supabase Auth's own invite (admin.inviteUserByEmail): there is no
// typed password and no custom mailer, so no new secret is needed. Supabase sends the standard invite
// email and the person sets their own password on the update-password page.
//
// POST { action: "invite", email, display_name, role, client_slug?, redirect_origin? }
// POST { action: "resend", invite_id }
// POST { action: "revoke", invite_id }
//
// Gate: a builder login. Clients, employees, logins with no role and the service role get 403; the
// gate runs before the body is read. Every invite is logged in user_invites (who invited whom,
// how many times it was sent). The create-with-password path in user-management stays as it was.
//
// Plain answers for the cases a person can fix: a login that already exists, an email that is
// already invited, an invite that was revoked or accepted, an email service that is limiting sends.

export interface InviteRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  client_slug: string | null;
  invited_user_id: string | null;
  invited_by: string;
  status: "sent" | "revoked";
  sent_count: number;
  created_at: string;
  last_sent_at: string;
}

export interface LoginState {
  userId: string;
  confirmed: boolean;
}

/** What the function needs from the database. The real one is supabaseStore() below. */
export interface Store {
  loginState(email: string): Promise<LoginState | null>;
  clientExists(slug: string): Promise<boolean>;
  findOpenInvite(email: string): Promise<InviteRow | null>;
  getInvite(id: string): Promise<InviteRow | null>;
  insertInvite(row: {
    email: string;
    display_name: string;
    role: string;
    client_slug: string | null;
    invited_user_id: string;
    invited_by: string;
  }): Promise<InviteRow>;
  markResent(id: string, by: string, now: Date): Promise<void>;
  markRevoked(id: string, by: string, now: Date): Promise<void>;
  grantRole(userId: string, role: string): Promise<void>;
  setDisplayName(userId: string, name: string): Promise<void>;
  linkMember(userId: string, clientSlug: string): Promise<void>;
}

interface AuthErrorLike {
  message: string;
  status?: number;
  code?: string;
}

/** The two Supabase Auth admin calls used. Tests pass a stand-in; nothing is sent from a test. */
export interface Admin {
  inviteUserByEmail(
    email: string,
    options: { data: Record<string, unknown>; redirectTo?: string },
  ): Promise<{ data: { user: { id: string } | null } | null; error: AuthErrorLike | null }>;
  deleteUser(id: string): Promise<{ error: AuthErrorLike | null }>;
}

export interface Deps {
  resolveCaller?: (req: Request) => Promise<Caller | Response>;
  store?: () => Store;
  admin?: () => Admin;
  now?: () => Date;
}

const ROLES = ["builder", "employee", "client"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORIGIN = /^https?:\/\/[^/\s?#]+$/;
const RESEND_WAIT_MS = 60_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
const refuse = (status: number, code: string, error: string) => json({ error, code }, status);

function sentOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

async function defaultResolveCaller(req: Request): Promise<Caller | Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  return await resolveCaller(req, createClient(url, key));
}

// ------------------------------------------------------------------ the real store and admin

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}
interface Query extends PromiseLike<QueryResult> {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<QueryResult>;
  single(): PromiseLike<QueryResult>;
}
interface Table {
  select(columns: string): Query;
  insert(row: Record<string, unknown>): Query;
  update(row: Record<string, unknown>): Query;
}
export interface SupabaseLike {
  from(table: string): Table;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
  auth: { admin: Admin };
}

function check(label: string, result: QueryResult): QueryResult {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

export function supabaseStore(db: SupabaseLike): Store {
  return {
    async loginState(email) {
      const r = check("invite_login_state", await db.rpc("invite_login_state", { p_email: email }));
      const row = (Array.isArray(r.data) ? r.data[0] : null) as { user_id: string; confirmed: boolean } | null;
      return row ? { userId: row.user_id, confirmed: row.confirmed === true } : null;
    },
    async clientExists(slug) {
      const r = check("clients", await db.from("clients").select("slug").eq("slug", slug).maybeSingle());
      return !!r.data;
    },
    async findOpenInvite(email) {
      const r = check("user_invites", await db.from("user_invites").select("*").eq("email", email).eq("status", "sent").maybeSingle());
      return (r.data as InviteRow | null) ?? null;
    },
    async getInvite(id) {
      const r = check("user_invites", await db.from("user_invites").select("*").eq("id", id).maybeSingle());
      return (r.data as InviteRow | null) ?? null;
    },
    async insertInvite(row) {
      const r = check("user_invites insert", await db.from("user_invites").insert(row).select("*").single());
      return r.data as InviteRow;
    },
    async markResent(id, by, now) {
      const current = check("user_invites", await db.from("user_invites").select("sent_count").eq("id", id).single());
      const count = Number((current.data as { sent_count: number }).sent_count) + 1;
      check("user_invites update", await db.from("user_invites").update({ sent_count: count, last_sent_at: now.toISOString(), last_sent_by: by }).eq("id", id));
    },
    async markRevoked(id, by, now) {
      check("user_invites update", await db.from("user_invites").update({ status: "revoked", revoked_at: now.toISOString(), revoked_by: by }).eq("id", id));
    },
    async grantRole(userId, role) {
      check("user_roles insert", await db.from("user_roles").insert({ user_id: userId, role }));
    },
    async setDisplayName(userId, name) {
      check("profiles update", await db.from("profiles").update({ display_name: name }).eq("user_id", userId));
    },
    async linkMember(userId, clientSlug) {
      check("client_members insert", await db.from("client_members").insert({ user_id: userId, client_slug: clientSlug }));
    },
  };
}

function serviceClient(): SupabaseLike {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server misconfigured");
  return createClient(url, key) as unknown as SupabaseLike;
}

// ------------------------------------------------------------------ the handler

function sendFailure(error: AuthErrorLike): Response {
  if (error.status === 429 || error.code === "over_email_send_rate_limit") {
    return refuse(429, "rate_limited", "The email service is limiting how many invites go out. Wait a few minutes and try again.");
  }
  if (error.status === 422 || error.code === "email_exists" || error.code === "user_already_exists") {
    return refuse(409, "already_has_login", "That email already has a login. Nothing was sent.");
  }
  // The message can name the address or the provider; keep it out of the answer.
  console.error("invite-user send failed:", error.code ?? error.status ?? "unknown");
  return refuse(502, "send_failed", "The invite email could not be sent. Check that email sending is set up for this project, then try again.");
}

type Raw = Record<string, unknown>;

async function invite(raw: Raw, caller: { userId: string }, store: Store, admin: Admin, now: Date): Promise<Response> {
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const name = typeof raw.display_name === "string" ? raw.display_name.trim() : "";
  const role = typeof raw.role === "string" ? raw.role : "";
  const slug = typeof raw.client_slug === "string" && raw.client_slug.trim() ? raw.client_slug.trim() : null;
  const origin = typeof raw.redirect_origin === "string" && ORIGIN.test(raw.redirect_origin) ? raw.redirect_origin : null;

  if (!EMAIL.test(email) || email.length > 320) return refuse(400, "invalid_email", "Enter a valid email address.");
  if (name.length < 1 || name.length > 120) return refuse(400, "invalid_name", "Enter the person's name (up to 120 characters).");
  if (!(ROLES as readonly string[]).includes(role)) return refuse(400, "invalid_role", "Choose Builder, Employee or Client.");
  if (role === "client" && !slug) return refuse(400, "client_required", "Choose which client this login is for.");
  if (role !== "client" && slug) return refuse(400, "client_not_allowed", "Only client logins are tied to a client.");
  if (slug && !(await store.clientExists(slug))) return refuse(404, "client_not_found", "We could not find that client.");

  const login = await store.loginState(email);
  const open = await store.findOpenInvite(email);
  if (login) {
    if (open && !login.confirmed) {
      return refuse(409, "already_invited", `${email} was already invited on ${sentOn(open.created_at)}. Use Resend to send the email again.`);
    }
    return refuse(409, "already_has_login", `${email} already has a login. Nothing was sent.`);
  }
  // An open invite whose login is gone (removed since) would block a new one: close it first.
  if (open) await store.markRevoked(open.id, caller.userId, now);

  const sent = await admin.inviteUserByEmail(email, {
    data: { display_name: name },
    ...(origin ? { redirectTo: `${origin}/update-password` } : {}),
  });
  if (sent.error) return sendFailure(sent.error);
  const userId = sent.data?.user?.id;
  if (!userId) {
    console.error("invite-user: the invite answered without a login");
    return refuse(502, "send_failed", "The invite email could not be sent. Check that email sending is set up for this project, then try again.");
  }

  try {
    await store.grantRole(userId, role);
    await store.setDisplayName(userId, name);
    if (slug) await store.linkMember(userId, slug);
    const row = await store.insertInvite({
      email, display_name: name, role, client_slug: slug, invited_user_id: userId, invited_by: caller.userId,
    });
    return json({ invite: publicInvite(row) });
  } catch (error) {
    console.error("invite-user setup failed:", error instanceof Error ? error.message : error);
    const removed = await admin.deleteUser(userId);
    if (removed.error) console.error("invite-user could not remove the half-made login:", removed.error.code ?? removed.error.status ?? "unknown");
    return refuse(500, "setup_failed", "The invite email went out, but the login could not be set up, so it was removed. Send the invite again.");
  }
}

async function resend(raw: Raw, caller: { userId: string }, store: Store, admin: Admin, now: Date): Promise<Response> {
  const id = typeof raw.invite_id === "string" ? raw.invite_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return refuse(400, "invalid_invite", "Choose an invite to resend.");
  const row = await store.getInvite(id);
  if (!row) return refuse(404, "invite_not_found", "We could not find that invite.");
  if (row.status === "revoked") return refuse(409, "revoked", "That invite was revoked. Send a new one.");
  const login = await store.loginState(row.email);
  if (login?.confirmed) return refuse(409, "already_accepted", `${row.email} has already accepted this invite.`);
  if (!login) {
    await store.markRevoked(row.id, caller.userId, now);
    return refuse(409, "login_gone", "That login no longer exists, so the invite was closed. Send a new one.");
  }
  if (now.getTime() - new Date(row.last_sent_at).getTime() < RESEND_WAIT_MS) {
    return refuse(429, "too_soon", "That invite was sent a moment ago. Wait a minute before sending it again.");
  }
  const origin = typeof raw.redirect_origin === "string" && ORIGIN.test(raw.redirect_origin) ? raw.redirect_origin : null;
  const sent = await admin.inviteUserByEmail(row.email, {
    data: { display_name: row.display_name },
    ...(origin ? { redirectTo: `${origin}/update-password` } : {}),
  });
  if (sent.error) return sendFailure(sent.error);
  await store.markResent(row.id, caller.userId, now);
  return json({ invite: publicInvite({ ...row, sent_count: row.sent_count + 1, last_sent_at: now.toISOString() }) });
}

async function revoke(raw: Raw, caller: { userId: string }, store: Store, admin: Admin, now: Date): Promise<Response> {
  const id = typeof raw.invite_id === "string" ? raw.invite_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return refuse(400, "invalid_invite", "Choose an invite to revoke.");
  const row = await store.getInvite(id);
  if (!row) return refuse(404, "invite_not_found", "We could not find that invite.");
  if (row.status === "revoked") return refuse(409, "revoked", "That invite was already revoked.");
  const login = await store.loginState(row.email);
  if (login?.confirmed) {
    return refuse(409, "already_accepted", `${row.email} has already accepted, so the invite cannot be revoked. Remove the login in Settings > Admin instead.`);
  }
  if (login) {
    const removed = await admin.deleteUser(login.userId);
    if (removed.error) {
      console.error("invite-user could not remove the login:", removed.error.code ?? removed.error.status ?? "unknown");
      return refuse(502, "revoke_failed", "The login could not be removed, so the invite is still open. Try again.");
    }
  }
  await store.markRevoked(row.id, caller.userId, now);
  return json({ invite: publicInvite({ ...row, status: "revoked" }) });
}

function publicInvite(row: InviteRow) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    client_slug: row.client_slug,
    status: row.status,
    sent_count: row.sent_count,
    last_sent_at: row.last_sent_at,
  };
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const caller = await (deps.resolveCaller ?? defaultResolveCaller)(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== "user" || !caller.roles.includes("builder")) {
    return json({ error: "Forbidden: builder only" }, 403);
  }

  let raw: Raw;
  try {
    raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
  } catch {
    return json({ error: "Body must be a JSON object" }, 400);
  }
  const action = raw.action;
  if (action !== "invite" && action !== "resend" && action !== "revoke") {
    return refuse(400, "invalid_action", "The action must be invite, resend or revoke.");
  }

  try {
    const client = deps.store && deps.admin ? null : serviceClient();
    const store = deps.store ? deps.store() : supabaseStore(client!);
    const admin = deps.admin ? deps.admin() : client!.auth.admin;
    const now = (deps.now ?? (() => new Date()))();
    const who = { userId: caller.userId };
    if (action === "invite") return await invite(raw, who, store, admin, now);
    if (action === "resend") return await resend(raw, who, store, admin, now);
    return await revoke(raw, who, store, admin, now);
  } catch (error) {
    console.error("invite-user error:", error instanceof Error ? error.message : error);
    return json({ error: "The invite could not be processed. Try again." }, 500);
  }
}

// Tests import the handler with INVITE_USER_NO_SERVE set.
if (!Deno.env.get("INVITE_USER_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
