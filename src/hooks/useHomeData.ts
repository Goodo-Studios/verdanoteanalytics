// Data for the staff Home blocks and the Work page. Every query reads a table straight through the
// same RLS-protected client the other staff pages use: staff read every row, a client login reads
// none of the handoff, support and budget tables and only its own cards. The hooks are also
// switched off for a client login, so the queries are not even sent from a client's browser.
// The select strings are listed in src/lib/pageQueries.ts and run against staging by
// scripts/staging-client-wall-check.mjs.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { HOME_BUDGET_ALERT_COLUMNS, HOME_HANDOFF_COLUMNS, HOME_SUPPORT_COLUMNS, HOME_TASK_COLUMNS } from "@/lib/pageQueries";
import { monthStartIso, type HomeBudgetAlert, type HomeHandoff, type HomeSupport, type HomeTask } from "@/lib/homeData";

type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & { eq(column: string, value: string): Query };
type Untyped = { from(table: string): { select(columns: string): Query } };
const db = () => supabase as unknown as Untyped;

async function rows<T>(q: PromiseLike<Result>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/** True for a real staff login that is not previewing the client view. */
export function useStaffHomeAccess(): { enabled: boolean; isBuilder: boolean; userId: string } {
  const { user, isBuilder, isEmployee, isClient } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  const staff = (isBuilder || isEmployee) && !isClient && !isClientPreview;
  return { enabled: staff, isBuilder: isBuilder && !isEmployeePreview, userId: user?.id ?? "" };
}

const REFRESH = 5 * 60 * 1000;

/** Every ClickUp card of every client. */
export function useAllWorkTasks() {
  const { enabled } = useStaffHomeAccess();
  return useQuery<HomeTask[]>({
    queryKey: ["home", "tasks"],
    enabled,
    refetchInterval: REFRESH,
    queryFn: () => rows<HomeTask>(db().from("pipeline_tasks").select(HOME_TASK_COLUMNS)),
  });
}

/** Handoff packets waiting on someone. The block keeps the ones addressed to the signed-in person. */
export function useReadyHandoffs() {
  const { enabled } = useStaffHomeAccess();
  return useQuery<HomeHandoff[]>({
    queryKey: ["home", "handoffs"],
    enabled,
    refetchInterval: REFRESH,
    queryFn: () => rows<HomeHandoff>(db().from("handoff_packets").select(HOME_HANDOFF_COLUMNS).eq("status", "ready")),
  });
}

/** Open support requests. Used for "my support requests" and for overdue updates. */
export function useOpenSupport() {
  const { enabled } = useStaffHomeAccess();
  return useQuery<HomeSupport[]>({
    queryKey: ["home", "support"],
    enabled,
    refetchInterval: REFRESH,
    queryFn: () => rows<HomeSupport>(db().from("support_requests").select(HOME_SUPPORT_COLUMNS).eq("status", "open")),
  });
}

/** Budget crossings recorded this month. Builder only (the table has no other reader). */
export function useBudgetAlerts() {
  const { enabled, isBuilder } = useStaffHomeAccess();
  const month = monthStartIso();
  return useQuery<HomeBudgetAlert[]>({
    queryKey: ["home", "budget", month],
    enabled: enabled && isBuilder,
    refetchInterval: REFRESH,
    queryFn: () => rows<HomeBudgetAlert>(db().from("operating_budget_alerts").select(HOME_BUDGET_ALERT_COLUMNS).eq("period_month", month)),
  });
}
