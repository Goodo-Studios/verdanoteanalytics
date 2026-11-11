// Plain rules for the client progress feed section on Integration health.

export interface IngestToken {
  id: string;
  name: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface IngestAuditRow {
  id: string;
  called_at: string;
  token_name: string | null;
  source: string | null;
  outcome: string;
  client_count: number;
  applied_count: number;
  rejected_count: number;
  deliverable_count: number;
  error_code: string | null;
}

export function tokenState(t: Pick<IngestToken, "revoked_at">): "active" | "revoked" {
  return t.revoked_at ? "revoked" : "active";
}

/** Vault name of the token for the project the page is running in. Production has no prefix. */
export function secretNameFor(environment: string): string {
  return environment === "production" ? "VERDANOTE_INGEST_TOKEN" : "STAGING_VERDANOTE_INGEST_TOKEN";
}

const ERROR_TEXT: Record<string, string> = {
  bad_shape: "the data was not in the expected shape",
  bad_json: "the body was not valid JSON",
  too_large: "the body was too large",
  content_type: "the content type was not JSON",
};

export function auditOutcomeLabel(a: Pick<IngestAuditRow, "outcome" | "rejected_count" | "error_code">): string {
  switch (a.outcome) {
    case "ok":
      return "accepted";
    case "partial":
      return `accepted, ${a.rejected_count} refused`;
    case "rejected":
      return a.error_code && ERROR_TEXT[a.error_code] ? `refused: ${ERROR_TEXT[a.error_code]}` : `refused, ${a.rejected_count} clients not known`;
    default:
      return "failed";
  }
}
