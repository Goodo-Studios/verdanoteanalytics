import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type Caller, resolveCaller } from "../_shared/internal-auth.ts";

// Client invites (Goodo OS story OS-021). A builder sends one approved batch of client invites.
//
// POST { action: "send", batch_id, redirect_origin? }
//
// Refuses unless: the caller is a builder login (403 before the body is read), the invite email
// text is approved, the batch is approved and has approved contacts left, and no client in the batch or its
// contacts is on the exclusion list or ending (os_client_invite_blocked).
//
// Off by default: unless CLIENT_INVITES_SEND_ENABLED=true the answer is a dry run listing what
// would be sent, and nothing is written or sent. When CLIENT_INVITES_ALLOWED_DOMAINS is set (a
// comma-separated list, e.g. staging.verdanote.test), only addresses on those domains are sent;
// the rest are listed as skipped and stay approved.
//
// Sending: a new address gets Supabase Auth's own invite (admin.inviteUserByEmail), which signs
// in with one click and has no password to set; the login gets the client role and is linked to
// its client. An address that already has a login gets a magic link (signInWithOtp, no new login).
// The approved subject and body go along as user metadata (invite_subject, invite_body) for the
// Auth email template. The database triggers check the same rules again when a row is marked sent.
// Nothing here calls ClickUp.

export interface Template {
  subject: string;
  body: string;
  approved_at: string | null;
}
export interface Batch {
  id: string;
  name: string;
  kind: "pilot" | "batch";
  client_slugs: string[];
  approved_at: string | null;
  sent_at: string | null;
}
export interface Invite {
  id: string;
  client_slug: string;
  email: string;
  display_name: string;
  status: "draft" | "approved" | "sent" | "accepted";
}
export interface LoginState {
  userId: string;
  confirmed: boolean;
}

/** What the function needs from the database. The real one is supabaseStore() below. */
export interface Store {
  template(): Promise<Template | null>;
  batch(id: string): Promise<Batch | null>;
  invites(batchId: string): Promise<Invite[]>;
  blockedReason(slug: string): Promise<string | null>;
  loginState(email: string): Promise<LoginState | null>;
  setUpClientLogin(userId: string, clientSlug: string, name: string): Promise<void>;
  markSent(inviteId: string, userId: string | null, now: Date): Promise<void>;
  markBatchSent(batchId: string, now: Date): Promise<void>;
}

interface AuthErrorLike {
  message: string;
  status?: number;
  code?: string;
}

/** The Auth calls that send email. Tests pass a stand-in; nothing is sent from a test. */
export interface Mailer {
  inviteUserByEmail(
    email: string,
    options: { data: Record<string, unknown>; redirectTo?: string },
  ): Promise<{ data: { user: { id: string } | null } | null; error: AuthErrorLike | null }>;
  sendMagicLink(email: string, redirectTo?: string): Promise<{ error: AuthErrorLike | null }>;
}

export interface Deps {
  resolveCaller?: (req: Request) => Promise<Caller | Response>;
  store?: () => Store;
  mailer?: () => Mailer;
  env?: (name: string) => string | undefined;
  now?: () => Date;
}

const UUID = /^[0-9a-f-]{36}$/i;
const ORIGIN = /^https?:\/\/[^/\s?#]+$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  json({ error, code, ...extra }, status);

/** The allowed domains, lower case, or null when the env is unset or empty (every domain). */
export function allowedDomains(raw: string | undefined): string[] | null {
  const list = (raw ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  return list.length ? list : null;
}

export function domainAllowed(email: string, domains: string[] | null): boolean {
  if (!domains) return true;
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1).toLowerCase() : "";
  return domains.includes(domain);
}

async function defaultResolveCaller(req: Request): Promise<Caller | Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  return await resolveCaller(req, createClient(url, key));
}

// ------------------------------------------------------------------ the real store and mailer

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}
interface Query extends PromiseLike<QueryResult> {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  maybeSingle(): PromiseLike<QueryResult>;
}
interface Table {
  select(columns: string): Query;
  insert(row: Record<string, unknown>): Query;
  update(row: Record<string, unknown>): Query;
}
interface SupabaseLike {
  from(table: string): Table;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
  auth: {
    admin: { inviteUserByEmail: Mailer["inviteUserByEmail"] };
    signInWithOtp(args: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo?: string } }): Promise<{ error: AuthErrorLike | null }>;
  };
}

function check(label: string, result: QueryResult): QueryResult {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

export function supabaseStore(db: SupabaseLike): Store {
  return {
    async template() {
      const r = check("template", await db.from("os_client_invite_template").select("subject, body, approved_at").maybeSingle());
      return (r.data as Template | null) ?? null;
    },
    async batch(id) {
      const r = check("batch", await db.from("os_client_invite_batches").select("id, name, kind, client_slugs, approved_at, sent_at").eq("id", id).maybeSingle());
      return (r.data as Batch | null) ?? null;
    },
    async invites(batchId) {
      const r = check("invites", await db.from("os_client_invites").select("id, client_slug, email, display_name, status").eq("batch_id", batchId));
      return (r.data as Invite[] | null) ?? [];
    },
    async blockedReason(slug) {
      const r = check("blocked", await db.rpc("os_client_invite_blocked", { p_slug: slug }));
      return typeof r.data === "string" ? r.data : null;
    },
    async loginState(email) {
      const r = check("invite_login_state", await db.rpc("invite_login_state", { p_email: email }));
      const row = (Array.isArray(r.data) ? r.data[0] : null) as { user_id: string; confirmed: boolean } | null;
      return row ? { userId: row.user_id, confirmed: row.confirmed === true } : null;
    },
    async setUpClientLogin(userId, clientSlug, name) {
      const role = await db.from("user_roles").insert({ user_id: userId, role: "client" });
      if (role.error && role.error.code !== "23505") throw new Error(`user_roles: ${role.error.message}`);
      const member = await db.from("client_members").insert({ user_id: userId, client_slug: clientSlug });
      if (member.error && member.error.code !== "23505") throw new Error(`client_members: ${member.error.message}`);
      check("profiles", await db.from("profiles").update({ display_name: name }).eq("user_id", userId));
    },
    async markSent(inviteId, userId, now) {
      check("invite sent", await db.from("os_client_invites")
        .update({ status: "sent", sent_at: now.toISOString(), ...(userId ? { invited_user_id: userId } : {}) })
        .eq("id", inviteId).eq("status", "approved"));
    },
    async markBatchSent(batchId, now) {
      check("batch sent", await db.from("os_client_invite_batches").update({ sent_at: now.toISOString() }).eq("id", batchId));
    },
  };
}

function serviceClient(): SupabaseLike {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server misconfigured");
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseLike;
}

function supabaseMailer(db: SupabaseLike): Mailer {
  return {
    inviteUserByEmail: (email, options) => db.auth.admin.inviteUserByEmail(email, options),
    sendMagicLink: (email, redirectTo) =>
      db.auth.signInWithOtp({ email, options: { shouldCreateUser: false, ...(redirectTo ? { emailRedirectTo: redirectTo } : {}) } }),
  };
}

// ------------------------------------------------------------------ the handler

interface Planned {
  invite_id: string;
  client_slug: string;
  email: string;
  display_name: string;
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const caller = await (deps.resolveCaller ?? defaultResolveCaller)(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== "user" || !caller.roles.includes("builder")) {
    return json({ error: "Forbidden: builder only" }, 403);
  }

  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
  } catch {
    return json({ error: "Body must be a JSON object" }, 400);
  }
  if (raw.action !== "send") return refuse(400, "invalid_action", "The action must be send.");
  const batchId = typeof raw.batch_id === "string" ? raw.batch_id : "";
  if (!UUID.test(batchId)) return refuse(400, "invalid_batch", "Choose a batch to send.");
  const origin = typeof raw.redirect_origin === "string" && ORIGIN.test(raw.redirect_origin) ? raw.redirect_origin : null;

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const enabled = env("CLIENT_INVITES_SEND_ENABLED") === "true";
  const domains = allowedDomains(env("CLIENT_INVITES_ALLOWED_DOMAINS"));

  try {
    const client = deps.store && deps.mailer ? null : serviceClient();
    const store = deps.store ? deps.store() : supabaseStore(client!);
    const now = (deps.now ?? (() => new Date()))();

    const template = await store.template();
    if (!template?.approved_at) {
      return refuse(409, "template_not_approved", "The invite email text is not approved. Approve it first.");
    }
    const batch = await store.batch(batchId);
    if (!batch) return refuse(404, "batch_not_found", "We could not find that batch.");
    if (!batch.approved_at) return refuse(409, "batch_not_approved", "This batch is not approved. Approve it first.");

    const invites = await store.invites(batchId);
    const slugs = [...new Set([...batch.client_slugs, ...invites.map((i) => i.client_slug)])];
    const blocked: { client_slug: string; reason: string }[] = [];
    for (const slug of slugs) {
      const reason = await store.blockedReason(slug);
      if (reason) blocked.push({ client_slug: slug, reason });
    }
    if (blocked.length) {
      return refuse(409, "excluded_client", "This batch has a client that must not be invited. Nothing was sent.", { blocked });
    }

    const ready = invites.filter((i) => i.status === "approved");
    if (!ready.length) {
      return batch.sent_at
        ? refuse(409, "already_sent", "Every contact in this batch was already sent.")
        : refuse(409, "nothing_to_send", "This batch has no approved contacts to send.");
    }
    const plan: Planned[] = [];
    const skipped: (Planned & { reason: string })[] = [];
    for (const i of ready) {
      const row = { invite_id: i.id, client_slug: i.client_slug, email: i.email, display_name: i.display_name };
      if (domainAllowed(i.email, domains)) plan.push(row);
      else skipped.push({ ...row, reason: "domain_not_allowed" });
    }

    if (!enabled) {
      return json({ dry_run: true, batch_id: batchId, would_send: plan, skipped, allowed_domains: domains });
    }

    const mailer = deps.mailer ? deps.mailer() : supabaseMailer(client!);
    const redirectTo = origin ? `${origin}/` : undefined;
    const sent: Planned[] = [];
    const failed: (Planned & { reason: string })[] = [];
    for (const p of plan) {
      const login = await store.loginState(p.email);
      if (login) {
        const r = await mailer.sendMagicLink(p.email, redirectTo);
        if (r.error) {
          failed.push({ ...p, reason: r.error.code ?? "send_failed" });
          continue;
        }
        await store.markSent(p.invite_id, login.userId, now);
        sent.push(p);
        continue;
      }
      const r = await mailer.inviteUserByEmail(p.email, {
        data: { display_name: p.display_name, invite_subject: template.subject, invite_body: template.body },
        ...(redirectTo ? { redirectTo } : {}),
      });
      const userId = r.data?.user?.id ?? null;
      if (r.error || !userId) {
        failed.push({ ...p, reason: r.error?.code ?? "send_failed" });
        continue;
      }
      await store.setUpClientLogin(userId, p.client_slug, p.display_name);
      await store.markSent(p.invite_id, userId, now);
      sent.push(p);
    }
    // The first send starts the two-week guest access clock; a later run for contacts that were
    // skipped or failed does not move it.
    if (sent.length && !batch.sent_at) await store.markBatchSent(batchId, now);
    return json({ dry_run: false, batch_id: batchId, sent, skipped, failed });
  } catch (error) {
    console.error("client-invite error:", error instanceof Error ? error.message : error);
    return json({ error: "The batch could not be processed. Try again." }, 500);
  }
}

// Tests import the handler with CLIENT_INVITE_NO_SERVE set.
if (!Deno.env.get("CLIENT_INVITE_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
