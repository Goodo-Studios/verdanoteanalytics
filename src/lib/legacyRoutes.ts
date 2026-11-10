// Old staff URLs and where they live now. Every page that moved under a section tab keeps
// working at its old address: the old route redirects to the new tab and keeps the query
// string, so bookmarks and the ?client= and ?brand= links still work.
import { SECTIONS } from "@/lib/sections";

export interface LegacyRedirect {
  /** Role-relative path the page used to have. */
  from: string;
  /** Role-relative path it has now. */
  to: string;
  /** Real clients, and a builder previewing the client view, may still open `from` itself. */
  clientAccessible?: boolean;
}

// Paths a client login still uses at the old address (its five menu items).
const CLIENT_ACCESSIBLE = new Set(["/creatives", "/analytics", "/reports"]);

export const LEGACY_REDIRECTS: LegacyRedirect[] = [
  ...SECTIONS.flatMap((section) =>
    section.tabs.flatMap((tab) =>
      tab.legacy.map((from) => ({
        from,
        to: `/${section.id}/${tab.slug}`,
        clientAccessible: CLIENT_ACCESSIBLE.has(from),
      })),
    ),
  ),
  { from: "/staff", to: "/" },
  { from: "/viral-feed", to: "/creative/vault" },
  { from: "/ad-library/viral", to: "/creative/vault" },
];

/** Where an old role-relative path now lives, or null when it did not move. */
export function resolveLegacyRoute(path: string): string | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return LEGACY_REDIRECTS.find((r) => r.from === clean)?.to ?? null;
}
