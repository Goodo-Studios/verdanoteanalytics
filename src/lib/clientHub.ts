// The client hub: /clients/:slug with tabs. The client is in the address, so nothing on a hub
// tab asks for it again. Pure data, read by the hub page, the redirects and the tests.
import type { PageKey } from "@/lib/sections";

export interface HubTabDef {
  /** URL segment after the client. Overview has none: /clients/:slug. */
  slug: string;
  label: string;
  page: PageKey;
  /** Reads the client's ad account: shows a plain message when it has none. */
  needsAccount?: boolean;
}

export const HUB_TABS: HubTabDef[] = [
  { slug: "overview", label: "Overview", page: "clientDetail" },
  { slug: "work", label: "Work", page: "clientWork" },
  { slug: "briefs", label: "Briefs", page: "briefs", needsAccount: true },
  { slug: "performance", label: "Performance", page: "clientPerformance" },
  { slug: "brand-doc", label: "Brand doc", page: "bidViewer" },
  { slug: "meetings", label: "Meetings", page: "meetingRecaps" },
  { slug: "scope", label: "Scope", page: "engagements" },
];

export interface ScopeSubDef {
  slug: string;
  label: string;
  page: PageKey;
}

export const SCOPE_SUBTABS: ScopeSubDef[] = [
  { slug: "engagements", label: "Engagements", page: "engagements" },
  { slug: "deliverables", label: "Deliverables", page: "deliverables" },
  { slug: "qa-gates", label: "QA gates", page: "qaGates" },
  { slug: "handoffs", label: "Handoffs", page: "handoffs" },
  { slug: "scope-changes", label: "Scope changes", page: "scopeChanges" },
  { slug: "strategy", label: "Strategy", page: "strategy" },
  { slug: "recommendations", label: "Recommendations", page: "recommendations" },
];

/** Role-relative address of a hub tab. */
export function hubPath(slug: string, tab?: string, sub?: string): string {
  const base = `/clients/${encodeURIComponent(slug)}`;
  if (!tab || tab === "overview") return base;
  return sub ? `${base}/${tab}/${sub}` : `${base}/${tab}`;
}

/**
 * Pages that used to stand alone and now live inside the client hub. Their old address redirects to
 * the same page for the selected client (from ?client=, ?brand= or the switcher), or to the client
 * list when no client is picked.
 */
export interface ClientScopedLegacy {
  from: string;
  tab: string;
  sub?: string;
}

export const CLIENT_SCOPED_LEGACY: ClientScopedLegacy[] = [
  { from: "/engagements", tab: "scope", sub: "engagements" },
  { from: "/deliverables", tab: "scope", sub: "deliverables" },
  { from: "/qa-gates", tab: "scope", sub: "qa-gates" },
  { from: "/handoffs", tab: "scope", sub: "handoffs" },
  { from: "/scope-changes", tab: "scope", sub: "scope-changes" },
  { from: "/strategy", tab: "scope", sub: "strategy" },
  { from: "/recommendations", tab: "scope", sub: "recommendations" },
];

/** The Content Pipeline board for staff is the Work tab. Clients keep /pipeline. */
export const STAFF_PIPELINE_LEGACY: ClientScopedLegacy = { from: "/pipeline", tab: "work" };

/** Where an old client-scoped address goes for a client, or null when the address is not one of them. */
export function resolveClientScopedRoute(path: string, slug: string): string | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const hit = [...CLIENT_SCOPED_LEGACY, STAFF_PIPELINE_LEGACY].find((r) => r.from === clean);
  if (!hit) return null;
  return slug ? hubPath(slug, hit.tab, hit.sub) : "/clients";
}
