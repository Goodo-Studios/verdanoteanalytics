// Creative Intelligence WS2 (US-004): classify a normalized destination_key into a
// destination TYPE + extract a product identity, purely from the URL path — no
// network. destination_key is produced by _shared/normalize-destination.ts
// (https://host/path?nonTrackingParams). Pure + throwing-free so it can run over
// any stored key and is unit-testable.
//
// An optional lightweight page-title (og:title) fetch lives in the resolve-
// destinations edge function and only REFINES the product name; classification
// itself is path-only (cheap, ToS-safe, deterministic).

export type DestinationType = "product" | "collection" | "homepage" | "lead-form" | "other";

export interface DestinationClassification {
  type: DestinationType;
  // Raw handle/slug pulled from the path (product OR collection handle), or null.
  productSlug: string | null;
  // Human-readable product name, set ONLY for product destinations; null otherwise.
  product: string | null;
}

// Hosts that are almost always lead capture / funnels, never a store product page.
const LEAD_FORM_HOSTS = [
  "typeform.com",
  "jotform.com",
  "tally.so",
  "getform.io",
  "surveymonkey.com",
  "calendly.com",
];

// Path segments that signal a lead/funnel page rather than a catalog page.
const LEAD_FORM_SEGMENTS = new Set([
  "quiz", "survey", "apply", "application", "get-started", "getstarted",
  "funnel", "vsl", "webinar", "book", "booking", "schedule", "consultation",
]);

// Turn a Shopify-style handle ("weighted-blanket-25lb") into a display name.
function humanizeSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function classifyDestination(destinationKey: string | null | undefined): DestinationClassification {
  const none: DestinationClassification = { type: "other", productSlug: null, product: null };
  if (!destinationKey) return none;

  let url: URL;
  try {
    url = new URL(destinationKey);
  } catch {
    return none;
  }

  const host = url.hostname.toLowerCase();
  // Path segments, lowercased, empties removed.
  const segs = url.pathname.split("/").map((s) => s.toLowerCase()).filter(Boolean);

  // Homepage: no meaningful path.
  if (segs.length === 0) return { type: "homepage", productSlug: null, product: null };

  // Lead-form host wins regardless of path.
  if (LEAD_FORM_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { type: "lead-form", productSlug: null, product: null };
  }
  // Lead-form path segment anywhere.
  if (segs.some((s) => LEAD_FORM_SEGMENTS.has(s))) {
    return { type: "lead-form", productSlug: null, product: null };
  }

  // Product patterns (Shopify /products/<handle>, incl. /collections/<c>/products/<h>;
  // generic /product/, /p/, /dp/ (Amazon), /item/).
  const productMarkers = ["products", "product", "p", "dp", "item"];
  for (let i = 0; i < segs.length; i++) {
    if (productMarkers.includes(segs[i]) && segs[i + 1]) {
      const slug = segs[i + 1];
      return { type: "product", productSlug: slug, product: humanizeSlug(slug) };
    }
  }

  // Collection / category patterns.
  const collectionMarkers = ["collections", "collection", "category", "categories", "c", "shop"];
  for (let i = 0; i < segs.length; i++) {
    if (collectionMarkers.includes(segs[i])) {
      const slug = segs[i + 1] ?? null;
      return { type: "collection", productSlug: slug, product: null };
    }
  }

  // Everything else (blogs, /pages/*, about, etc.).
  return none;
}

// Pull a product name from a fetched page title / og:title (optional refinement).
// Strips common " | Brand" / " – Brand" suffixes. Returns null when empty.
export function productNameFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const cleaned = title.split(/[|–—]/)[0].trim();
  return cleaned.length ? cleaned : null;
}
