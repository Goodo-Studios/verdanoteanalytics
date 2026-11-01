// Password gate for the STAGING site only.
//
// Active when the Vercel project has STAGING_SITE=1. It then requires HTTP Basic
// auth with STAGING_GATE_USER / STAGING_GATE_PASSWORD. If STAGING_SITE=1 but the
// password is not set, the site answers 503 instead of opening up (fails closed).
// On production (no STAGING_SITE variable) it passes every request through.

export const config = { matcher: "/:path*" };

// Same response the `next()` helper from @vercel/functions returns.
const pass = () => new Response(null, { headers: { "x-middleware-next": "1" } });

const unauthorized = () =>
  new Response("Staging. Sign-in required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Verdanote staging", charset="UTF-8"' },
  });

export default function middleware(request: Request) {
  if (process.env.STAGING_SITE !== "1") return pass();

  const user = process.env.STAGING_GATE_USER;
  const password = process.env.STAGING_GATE_PASSWORD;
  if (!user || !password) return new Response("Staging gate is not configured.", { status: 503 });

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return unauthorized();
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized();
  }
  return decoded === `${user}:${password}` ? pass() : unauthorized();
}
