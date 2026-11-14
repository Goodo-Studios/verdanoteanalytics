// Data for time reports (OS-013): the entries in a date range, and one client's hours this month
// with its scope hours. One query per view. time_entries, time_people and clients.monthly_scope_hours
// are not in the generated types yet, so the calls go through a small untyped shape (as useMyWork
// does for os_tasks).
//
// Who sees what is enforced by row rules, not here: a builder reads everyone's entries, an employee
// only their own, a client none. The client hub's month total is the exception: it comes from a
// staff-only function that returns just the total over everyone's time.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReportEntry } from "@/lib/timeReports";

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
interface Query extends Result {
  eq(column: string, value: string): Query;
  not(column: string, op: string, value: null): Query;
  gte(column: string, value: string): Query;
  lt(column: string, value: string): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
  maybeSingle(): Result;
}
type Untyped = {
  from(table: string): { select(columns: string): Query };
  rpc(fn: string, args?: Record<string, unknown>): Result;
};
const db = () => supabase as unknown as Untyped;

/** Only what the report shows, with the person, task, client and Goodo Time project names. */
export const REPORT_COLUMNS =
  "id, person_id, task_id, client_slug, is_internal, category, description, start_at, end_at, source_id, project_id, " +
  "person:time_people(name, email), task:os_tasks(title, content_type), client:clients(name), " +
  "project:time_projects(name, client:time_clients(name))";

export const REPORT_KEY = "time-report";
export const CLIENT_MONTH_KEY = "client-month-hours";
const PAGE = 1000;

/** Completed entries that started in [fromIso, toIso), oldest first. Reads every page. */
export function useTimeReport(fromIso: string | null, toIso: string | null, enabled = true) {
  return useQuery<ReportEntry[]>({
    queryKey: [REPORT_KEY, fromIso, toIso],
    enabled: enabled && !!fromIso && !!toIso,
    queryFn: async () => {
      const out: ReportEntry[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db()
          .from("time_entries")
          .select(REPORT_COLUMNS)
          .gte("start_at", fromIso!)
          .lt("start_at", toIso!)
          .not("end_at", "is", null)
          .order("start_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as ReportEntry[];
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out;
    },
  });
}

export interface ClientMonth {
  seconds: number;
  scopeHours: number | null;
}

/**
 * A client's completed hours in [fromIso, toIso) and its monthly scope hours. The hours come from
 * time_client_month_seconds, a staff-only database function that totals every person's entries
 * for the client: an employee can read only their own time_entries rows, so embedding the entries
 * under row rules undercounted for employees. Counts entries tagged with this client (client_slug).
 */
export function useClientMonthHours(slug: string | undefined, fromIso: string, toIso: string, enabled = true) {
  return useQuery<ClientMonth>({
    queryKey: [CLIENT_MONTH_KEY, slug, fromIso, toIso],
    enabled: enabled && !!slug,
    queryFn: async () => {
      const [scopeRes, secondsRes] = await Promise.all([
        db().from("clients").select("monthly_scope_hours").eq("slug", slug!).maybeSingle(),
        db().rpc("time_client_month_seconds", { p_client_slug: slug!, p_from: fromIso, p_to: toIso }),
      ]);
      if (scopeRes.error) throw new Error(scopeRes.error.message);
      if (secondsRes.error) throw new Error(secondsRes.error.message);
      const scope = (scopeRes.data as { monthly_scope_hours: number | string | null } | null)?.monthly_scope_hours;
      return {
        // A bigint comes back as a number (or a string for very large values).
        seconds: Math.max(0, Number(secondsRes.data ?? 0)),
        scopeHours: scope == null ? null : Number(scope),
      };
    },
  });
}

/** Builder only (the database checks): set or clear a client's monthly scope hours. */
export function useSetScopeHours(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hours: number | null) => {
      const { error } = await db().rpc("set_client_scope_hours", { p_slug: slug, p_hours: hours });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [CLIENT_MONTH_KEY, slug] }),
  });
}
