import type { Page } from "@playwright/test";

// The four staging test logins (docs/staging.md). They exist only in the staging project.
export const LOGINS = {
  builder: "builder@staging.verdanote.test",
  employee: "employee@staging.verdanote.test",
  client: "client-a@staging.verdanote.test",
} as const;

export type Role = keyof typeof LOGINS;

export const AUTH_DIR = "e2e-staging/.auth";
export const storagePath = (role: Role) => `${AUTH_DIR}/${role}.json`;

export const TEST_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";
export const hasLogins = TEST_PASSWORD.length > 0;
export const NEEDS_PASSWORD = "Set STAGING_TEST_PASSWORD (vault secret of the same name) to run the staging browser tests";

/**
 * Console errors known today, each with the reason. A new kind of error is a failure; an entry
 * here is removed when its cause is fixed.
 *
 * Google Fonts: index.html loads the brand fonts from fonts.googleapis.com, and the CSP in
 * vercel.json (style-src 'self' 'unsafe-inline', font-src 'self' data:) blocks the stylesheet, so
 * the page falls back to system fonts. Fix by self-hosting the fonts or widening the CSP; that is
 * a design and security call, so it is listed here instead of fixed in a test change.
 */
const KNOWN_ERRORS: RegExp[] = [/^Loading the stylesheet 'https:\/\/fonts\.googleapis\.com\/.*violates the following Content Security Policy/];

/**
 * Collects what a person would call a broken page: an uncaught error, or a console.error.
 *
 * One kind of message is left out: the browser's own "Failed to load resource ... status of 4xx/5xx"
 * line. Staging has no ClickUp, Slack, Fireflies or Resend keys on purpose, so a few server
 * functions answer 503 there, and the page is meant to show that as a message. Those lines say
 * nothing the page does not already show; the server side is covered by the function tests.
 * Everything else counts, including a failed request the app logs itself.
 */
export function watchConsole(page: Page, alsoKnown: RegExp[] = []) {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (KNOWN_ERRORS.some((re) => re.test(text)) || alsoKnown.some((re) => re.test(text))) return;
    if (/^Failed to load resource: the server responded with a status of (4|5)\d\d/.test(text)) return;
    problems.push(`console.error: ${text}`);
  });
  return { problems: () => [...problems] };
}
