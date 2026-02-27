import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/* ── Types ────────────────────────────────── */

export interface BriefTemplate {
  id: string;
  account_id: string | null;
  name: string;
  format: string | null;
  sections: any[];
  created_by: string | null;
  created_at: string;
}

export interface Brief {
  id: string;
  account_id: string;
  template_id: string | null;
  name: string;
  status: string;
  assignee_name: string | null;
  due_date: string | null;
  reference_ad_ids: string[];
  content: Record<string, any>;
  share_token: string;
  created_by: string | null;
  created_at: string;
}

/* ── Hooks ────────────────────────────────── */

export function useBriefs(accountId?: string) {
  return useQuery<Brief[]>({
    queryKey: ["briefs", accountId],
    queryFn: async () => {
      let q = supabase.from("briefs" as any).select("*").order("created_at", { ascending: false });
      if (accountId && accountId !== "all") q = q.eq("account_id", accountId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
}

export function useBriefTemplates() {
  return useQuery<BriefTemplate[]>({
    queryKey: ["brief_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brief_templates" as any).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
}

export function useBriefByShareToken(token: string | undefined) {
  return useQuery<Brief | null>({
    queryKey: ["brief_share", token],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefs" as any)
        .select("*")
        .eq("share_token", token)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Brief) || null;
    },
  });
}

export function useCreateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (brief: Partial<Brief>) => {
      const { data, error } = await supabase.from("briefs" as any).insert(brief as any).select().single();
      if (error) throw error;
      return data as unknown as Brief;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
      toast.success("Brief created");
    },
    onError: (e: any) => toast.error("Failed to create brief", { description: e.message }),
  });
}

export function useUpdateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Brief> & { id: string }) => {
      const { error } = await supabase.from("briefs" as any).update(updates as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
    },
    onError: (e: any) => toast.error("Failed to update brief", { description: e.message }),
  });
}

export function useDeleteBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("briefs" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
      toast.success("Brief deleted");
    },
    onError: (e: any) => toast.error("Failed to delete brief", { description: e.message }),
  });
}

export function useCreateBriefTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (template: Partial<BriefTemplate>) => {
      const { data, error } = await supabase.from("brief_templates" as any).insert(template as any).select().single();
      if (error) throw error;
      return data as unknown as BriefTemplate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brief_templates"] });
      toast.success("Template saved");
    },
    onError: (e: any) => toast.error("Failed to save template", { description: e.message }),
  });
}
