// Pages with no data behind them yet. Until something feeds them they are left out of the
// sidebar tabs, the Home cards and the Cmd+K palette, and employees and clients are sent home
// when they open the address. A builder can still open the address, and lists every one of
// them under Admin > Early pages, so nothing is lost.
//
// To show a page again, remove its key from HIDDEN_PAGES (one line). Showing all of them again
// is an empty list. To hide a page, add its key and a note in EARLY_PAGE_NOTES.
//
// Agent evaluations, Learning, Recommendations and Strategy were hidden here until they had data.
// They are now shown in the menu, so the list is empty. Their notes stay so they can be hidden
// again with one line.
import type { PageKey } from "@/lib/sections";

// Hidden after the 2026-11-16 product review: Operations, Early pages, Operating costs, Agent
// evaluations and the Support inbox (not needed day to day), and the client Scope sub-tabs other
// than Engagements (Deliverables, QA gates, Handoffs, Scope changes, Strategy, Recommendations).
export const HIDDEN_PAGES: readonly PageKey[] = [
  "operations",
  "earlyPages",
  "operatingCosts",
  "agentEvaluations",
  "supportInbox",
  "deliverables",
  "qaGates",
  "handoffs",
  "scopeChanges",
  "strategy",
  "recommendations",
];

export interface EarlyPageNote {
  label: string;
  /** What has to feed the page before it is worth showing. One line. */
  feeds: string;
  /** Role-relative address a builder opens it at. */
  to: string;
}

export const EARLY_PAGE_NOTES: Partial<Record<PageKey, EarlyPageNote>> = {
  operations: { label: "Operations", feeds: "Hidden by choice: per-person pages are used instead.", to: "/admin/operations" },
  operatingCosts: { label: "Operating costs", feeds: "Hidden by choice for now.", to: "/admin/operating-costs" },
  supportInbox: { label: "Support inbox", feeds: "Hidden by choice: questions come in through Slack.", to: "/admin/support" },
  deliverables: { label: "Deliverables", feeds: "Hidden by choice: the client Scope tab keeps Engagements only.", to: "/clients" },
  qaGates: { label: "QA gates", feeds: "Hidden by choice: the client Scope tab keeps Engagements only.", to: "/clients" },
  handoffs: { label: "Handoffs", feeds: "Hidden by choice: the client Scope tab keeps Engagements only.", to: "/clients" },
  scopeChanges: { label: "Scope changes", feeds: "Hidden by choice: the client Scope tab keeps Engagements only.", to: "/clients" },
  agentEvaluations: {
    label: "Agent evaluations",
    feeds: "Fed by test requests staff write for an agent and the runs against it; nothing is recorded yet and approval gates nothing.",
    to: "/admin/agent-evaluations",
  },
  learning: {
    label: "Learning",
    feeds: "Fed by client lessons staff draft and review, and by the weekly count of how-to questions per engagement; none are entered yet.",
    to: "/knowledge/learning",
  },
  recommendations: {
    label: "Recommendations",
    feeds: "Fed by recommendations staff propose per engagement, with the ads that carry them out and a measured outcome; none are proposed yet.",
    to: "/recommendations",
  },
  strategy: {
    label: "Strategy",
    feeds: "Fed by strategy proposals a strategist writes per engagement and another person reviews; none are written yet.",
    to: "/strategy",
  },
};

export const isHiddenPage = (page: PageKey): boolean => HIDDEN_PAGES.includes(page);
