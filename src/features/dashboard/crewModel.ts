// Crew: staff page model (consolidation step 5c, port of the old dashboard's
// /crew page). The people Goodo books for shoots: role (free text, with a few
// suggestions), rate notes, phone and email. Rows come from crew_members
// (migration 20261101000001, staff-only row rules) and are written through the
// checked functions create_crew_member, update_crew_member and
// archive_crew_member. Phone, email and rates are personal data that no client
// login may read. Pure helpers only.

export const SUGGESTED_CREW_ROLES = ["Videographer", "Director", "PA", "Stylist"] as const;

export interface CrewMember {
  id: string;
  name: string;
  role: string;
  rate_notes: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  updated_at: string;
}

export interface CrewFilters {
  search: string;
  role: string;
  showArchived: boolean;
  sort: "name" | "role";
}

export const DEFAULT_CREW_FILTERS: CrewFilters = { search: "", role: "", showArchived: false, sort: "name" };

export function filterCrew(list: CrewMember[], f: CrewFilters): CrewMember[] {
  const q = f.search.trim().toLowerCase();
  return list
    .filter((c) => f.showArchived || c.active)
    .filter((c) => !f.role || c.role === f.role)
    .filter((c) => !q || [c.name, c.role, c.phone, c.email, c.notes, c.rate_notes].filter(Boolean).join(" ").toLowerCase().includes(q))
    .sort((a, b) => (f.sort === "role" ? a.role.localeCompare(b.role) : 0) || a.name.localeCompare(b.name));
}

export function roleOptions(list: CrewMember[]): string[] {
  return [...new Set([...SUGGESTED_CREW_ROLES, ...list.map((c) => c.role)])].sort((a, b) => a.localeCompare(b));
}

/** tel: and mailto: links only for values that look like a phone number or an email. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : null;
}

export function mailHref(email: string | null): string | null {
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : null;
}

export interface CrewForm {
  name: string;
  role: string;
  rate_notes: string;
  phone: string;
  email: string;
  notes: string;
}

export const EMPTY_CREW_FORM: CrewForm = { name: "", role: "", rate_notes: "", phone: "", email: "", notes: "" };

export function crewToForm(c: CrewMember): CrewForm {
  return { name: c.name, role: c.role, rate_notes: c.rate_notes ?? "", phone: c.phone ?? "", email: c.email ?? "", notes: c.notes ?? "" };
}

export interface CrewArgs {
  p_name: string;
  p_role: string;
  p_rate_notes: string | null;
  p_phone: string | null;
  p_email: string | null;
  p_notes: string | null;
}

const blank = (v: string) => (v.trim() ? v.trim() : null);

/** Checks the form the way the database will, so a bad value is caught before any call. */
export function formToCrewArgs(f: CrewForm): CrewArgs {
  if (!f.name.trim()) throw new Error("A name is required.");
  if (!f.role.trim()) throw new Error("A role is required.");
  const email = blank(f.email);
  if (email && !mailHref(email)) throw new Error("The email does not look like an email address.");
  return { p_name: f.name.trim(), p_role: f.role.trim(), p_rate_notes: blank(f.rate_notes), p_phone: blank(f.phone), p_email: email, p_notes: blank(f.notes) };
}
