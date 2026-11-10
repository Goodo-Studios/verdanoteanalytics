// Creator and actor rosters (consolidation step 5b, port of the old dashboard's
// Creators and Actors pages). Rows come from dashboard_creators and actors
// (migration 20261101000001, staff-only row rules). Pure helpers only: the
// filters, sort and paging of the list pages and the form parsing of the
// detail pages, ported from the old dashboard's src/lib/creatorFilters.ts,
// creatorForm.ts and actorForm.ts.

/** The 16 canonical creator categories, in display order (old creatorCategories.ts). */
export const CREATOR_CATEGORIES = [
  "Food/Beverage", "Apparel/Jewelry", "Health & Wellness", "Tech", "SaaS/Apps", "Home", "Kids/Babies",
  "Beauty", "Haircare", "Skincare", "Pet", "Dog", "Cat", "Couples", "Outdoor", "Travel",
] as const;

export const PAGE_SIZE = 50;

export interface RosterCreator {
  id: string;
  name: string;
  email: string | null;
  gender: string | null;
  scale: number | null;
  categories: string[];
  age_range: string[];
  location: string | null;
  trialed: boolean;
  do_not_use_again: boolean;
  categories_needs_review: boolean;
  source: string;
  headshot_path: string | null;
  created_at: string;
}

export const ROSTER_CREATOR_COLUMNS =
  "id, name, email, gender, scale, categories, age_range, location, trialed, do_not_use_again, categories_needs_review, source, headshot_path, created_at";

export interface CreatorRecord extends RosterCreator {
  website: string | null;
  portfolio_url: string | null;
  shipping_address: string | null;
  contact_notes: string | null;
  alcohol_ok: boolean;
  cbd_ok: boolean;
  thc_ok: boolean;
  family_inclusive_ok: boolean;
  import_notes: string | null;
  updated_at: string;
}

export const CREATOR_RECORD_COLUMNS = `${ROSTER_CREATOR_COLUMNS}, website, portfolio_url, shipping_address, contact_notes, alcohol_ok, cbd_ok, thc_ok, family_inclusive_ok, import_notes, updated_at`;

// --------------------------------------------------------------- list filters

export type CreatorSort = "name" | "scale" | "newest";

export interface CreatorFilters {
  search: string;
  category: string;
  minScale: number | null;
  gender: string;
  showDoNotUse: boolean;
  trialedOnly: boolean;
  needsReviewOnly: boolean;
  sort: CreatorSort;
  page: number;
}

export const DEFAULT_CREATOR_FILTERS: CreatorFilters = {
  search: "", category: "", minScale: null, gender: "", showDoNotUse: false, trialedOnly: false, needsReviewOnly: false, sort: "name", page: 1,
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Filters live in the address so a filtered list can be shared and survives a reload. */
export function creatorFiltersFromParams(p: URLSearchParams): CreatorFilters {
  const scale = Number(p.get("scale"));
  const page = Number(p.get("page"));
  const sort = p.get("sort");
  return {
    search: p.get("q") ?? "",
    category: p.get("category") ?? "",
    minScale: Number.isInteger(scale) && scale >= 1 && scale <= 5 ? scale : null,
    gender: p.get("gender") ?? "",
    showDoNotUse: p.get("dnu") === "1",
    trialedOnly: p.get("trialed") === "1",
    needsReviewOnly: p.get("review") === "1",
    sort: sort === "scale" || sort === "newest" ? sort : "name",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function creatorFiltersToParams(f: CreatorFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search.trim()) p.set("q", f.search);
  if (f.category) p.set("category", f.category);
  if (f.minScale !== null) p.set("scale", String(f.minScale));
  if (f.gender) p.set("gender", f.gender);
  if (f.showDoNotUse) p.set("dnu", "1");
  if (f.trialedOnly) p.set("trialed", "1");
  if (f.needsReviewOnly) p.set("review", "1");
  if (f.sort !== "name") p.set("sort", f.sort);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

/** Every filter must pass. Search matches name, email, location and categories. */
export function filterCreators<T extends RosterCreator>(rows: T[], f: CreatorFilters): T[] {
  const q = norm(f.search);
  const category = norm(f.category);
  const gender = norm(f.gender);
  return rows.filter((c) => {
    if (!f.showDoNotUse && c.do_not_use_again) return false;
    if (f.minScale !== null && (c.scale === null || c.scale < f.minScale)) return false;
    if (f.trialedOnly && !c.trialed) return false;
    if (f.needsReviewOnly && !c.categories_needs_review) return false;
    if (gender && norm(c.gender) !== gender) return false;
    if (category && !c.categories.some((x) => norm(x) === category)) return false;
    if (q) {
      const hay = [c.name, c.email, c.location, ...c.categories].map(norm).join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortCreators<T extends RosterCreator>(rows: T[], sort: CreatorSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const out = [...rows];
  if (sort === "scale") out.sort((a, b) => (b.scale ?? 0) - (a.scale ?? 0) || byName(a, b));
  else if (sort === "newest") out.sort((a, b) => b.created_at.localeCompare(a.created_at) || byName(a, b));
  else out.sort(byName);
  return out;
}

export interface Paged<T> {
  rows: T[];
  page: number;
  pages: number;
  total: number;
}

/** A page past the end shows the last page instead of an empty table. */
export function paginate<T>(rows: T[], page: number, size = PAGE_SIZE): Paged<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

/** Distinct genders present on the roster, for the filter menu. */
export function genderOptions(rows: { gender: string | null }[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const g = (r.gender ?? "").trim();
    if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// --------------------------------------------------------------- forms

export function parseList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function blankToNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

/** Categories outside the canonical 16 (imported free text) are kept, and shown apart. */
export function splitCategories(values: string[]): { canonical: string[]; legacy: string[] } {
  const canon = new Set<string>(CREATOR_CATEGORIES);
  return { canonical: values.filter((v) => canon.has(v)), legacy: values.filter((v) => !canon.has(v)) };
}

export interface CreatorForm {
  name: string;
  email: string;
  website: string;
  portfolio_url: string;
  gender: string;
  scale: string;
  categories: string[];
  age_range: string;
  location: string;
  shipping_address: string;
  contact_notes: string;
  trialed: boolean;
  do_not_use_again: boolean;
  alcohol_ok: boolean;
  cbd_ok: boolean;
  thc_ok: boolean;
  family_inclusive_ok: boolean;
}

export function creatorToForm(c: CreatorRecord): CreatorForm {
  return {
    name: c.name, email: c.email ?? "", website: c.website ?? "", portfolio_url: c.portfolio_url ?? "", gender: c.gender ?? "",
    scale: c.scale === null ? "" : String(c.scale), categories: [...c.categories], age_range: c.age_range.join(", "),
    location: c.location ?? "", shipping_address: c.shipping_address ?? "", contact_notes: c.contact_notes ?? "",
    trialed: c.trialed, do_not_use_again: c.do_not_use_again, alcohol_ok: c.alcohol_ok, cbd_ok: c.cbd_ok, thc_ok: c.thc_ok,
    family_inclusive_ok: c.family_inclusive_ok,
  };
}

export type CreatorPatch = Omit<CreatorForm, "email" | "website" | "portfolio_url" | "gender" | "scale" | "age_range" | "location" | "shipping_address" | "contact_notes"> & {
  email: string | null;
  website: string | null;
  portfolio_url: string | null;
  gender: string | null;
  scale: number | null;
  age_range: string[];
  location: string | null;
  shipping_address: string | null;
  contact_notes: string | null;
};

/** Form values to a row patch, or an error message. A name is required; scale is 1 to 5 or blank. */
export function creatorFormToPatch(f: CreatorForm): { patch: CreatorPatch } | { error: string } {
  const name = f.name.trim();
  if (!name) return { error: "A name is required." };
  let scale: number | null = null;
  if (f.scale.trim()) {
    const n = Number(f.scale);
    if (!Number.isInteger(n) || n < 1 || n > 5) return { error: "Scale is a whole number from 1 to 5." };
    scale = n;
  }
  return {
    patch: {
      name, email: blankToNull(f.email), website: blankToNull(f.website), portfolio_url: blankToNull(f.portfolio_url),
      gender: blankToNull(f.gender), scale, categories: [...f.categories], age_range: parseList(f.age_range),
      location: blankToNull(f.location), shipping_address: blankToNull(f.shipping_address), contact_notes: blankToNull(f.contact_notes),
      trialed: f.trialed, do_not_use_again: f.do_not_use_again, alcohol_ok: f.alcohol_ok, cbd_ok: f.cbd_ok, thc_ok: f.thc_ok,
      family_inclusive_ok: f.family_inclusive_ok,
    },
  };
}

/** Only http(s) links are opened; a bare domain gets https. Anything else is not linked. */
export function safeHref(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("//")) return null;
  return `https://${v}`;
}
