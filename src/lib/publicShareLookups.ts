/**
 * Shared report and brief links (audit plan item 1.3).
 *
 * A link is opened through a lookup function that returns only the row the link names
 * (get_public_report, get_shared_brief). The open "anyone can read every shared row" policies
 * are being removed, so the pages must not depend on reading the tables directly as anon.
 *
 * A signed-in staff member may open the link of a row that is not shared (for example to check
 * a report before making it public). The lookup returns nothing for that row, so the direct
 * read is tried next; row rules decide what that person may see.
 */
import { supabase } from "@/integrations/supabase/client";

type Row = Record<string, unknown>;

async function viaLookup(fn: "get_public_report" | "get_shared_brief", args: Record<string, string>): Promise<Row | null> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Row[];
  return rows[0] ?? null;
}

async function signedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session?.user;
}

export async function fetchPublicReport(id: string): Promise<Row | null> {
  const row = await viaLookup("get_public_report", { p_id: id });
  if (row) return row;
  if (!(await signedIn())) return null;
  const { data, error } = await supabase.from("reports").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}

export async function fetchSharedBrief(token: string): Promise<Row | null> {
  const row = await viaLookup("get_shared_brief", { p_token: token });
  if (row) return row;
  if (!(await signedIn())) return null;
  const { data, error } = await supabase.from("briefs" as any).select("*").eq("share_token", token).maybeSingle();
  if (error) throw error;
  return (data as unknown as Row | null) ?? null;
}
