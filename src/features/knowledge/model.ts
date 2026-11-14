// Knowledge pages model. Rows come from knowledge_sources and knowledge_source_versions
// (staff-only row rules, migration 20261110000003). Staff edit a source in place through
// edit_knowledge_source (migration 20261207080001), which adds the next version; the page shows
// the current version. The change-request flow (knowledge_corrections and their reviews) is no
// longer used by the app; its tables keep their rows. The database stays the authority.

export interface SourceVersion {
  id: string;
  version: number;
  body: string;
  kind: "create" | "publish" | "rollback" | "edit";
  correction_id: string | null;
  rolled_back_to: number | null;
  reason: string | null;
  published_by: string;
  created_at: string;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  namespace: string;
  classification: "client" | "staff";
  release_scope: "global" | "client";
  client_slug: string | null;
  citation_url: string | null;
  current_version: number;
  updated_at: string;
  /** Only the newest version is loaded: it is the current text. */
  versions: SourceVersion[];
}

export const currentVersion = (s: KnowledgeSource): SourceVersion | undefined => s.versions.find((v) => v.version === s.current_version);

/** Plain-language message for a database error code from the checked functions. */
export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "Someone else changed this document since you opened it. Reload and try again.";
    case "42501":
      return "You are not allowed to do that here.";
    case "22023":
      return "Nothing changed: the text is the same as what is saved.";
    case "23514":
      return "Check the fields: a client-wide source needs a client, and text cannot be empty or over 20,000 characters.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

/** Shapes the nested select into sources with their versions, newest first. */
export function toSources(rows: unknown): KnowledgeSource[] {
  return asArray<Record<string, unknown>>(rows).map((r) => ({
    ...(r as unknown as KnowledgeSource),
    versions: asArray<SourceVersion>(r.knowledge_source_versions).sort((a, b) => b.version - a.version),
  }));
}

export function matchesSearch(s: KnowledgeSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const body = currentVersion(s)?.body ?? "";
  return `${s.title} ${s.namespace} ${s.client_slug ?? ""} ${body}`.toLowerCase().includes(q);
}
