import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * "This Period's Highlights" data layer (US-005).
 *
 * Two read paths intentionally keep the client/strategist surfaces separate:
 *   - Clients read through the `client_highlights_published` VIEW, which omits
 *     `draft_text` and `status` entirely — a client can NEVER see an unpublished
 *     draft, by construction of the view, not just the UI.
 *   - Strategists (builder/employee) read the base `client_highlights` table so
 *     they can see the in-progress draft, edit it, and publish it.
 *
 * All writes go through the RLS-protected Supabase client. No new edge function:
 * the draft text is seeded by the existing `client-insights` function.
 */

/** Client-visible shape — sourced from the published view (no draft/status). */
export interface PublishedHighlight {
  account_id: string;
  period: string;
  published_text: string | null;
  published_at: string | null;
}

/** Strategist-visible shape — full row including draft + status. */
export interface HighlightDraft {
  account_id: string;
  period: string;
  draft_text: string | null;
  published_text: string | null;
  status: string;
  published_at: string | null;
}

/**
 * Client read: only the published narrative for (account, period), via the
 * security-definer view that never exposes draft_text.
 */
export function usePublishedHighlight(opts: {
  accountId?: string;
  period: string;
  enabled?: boolean;
}) {
  const { accountId, period, enabled = true } = opts;

  return useQuery<PublishedHighlight | null>({
    queryKey: ["published-highlight", accountId, period],
    enabled: enabled && !!accountId,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_highlights_published")
        .select("account_id, period, published_text, published_at")
        .eq("account_id", accountId!)
        .eq("period", period)
        .maybeSingle();

      if (error) throw error;
      return (data as PublishedHighlight | null) ?? null;
    },
  });
}

/**
 * Strategist read: the full draft row (draft_text + published_text + status).
 * Only called from the authoring container, which is gated on builder/employee.
 */
export function useHighlightDraft(opts: {
  accountId?: string;
  period: string;
  enabled?: boolean;
}) {
  const { accountId, period, enabled = true } = opts;

  return useQuery<HighlightDraft | null>({
    queryKey: ["highlight-draft", accountId, period],
    enabled: enabled && !!accountId,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_highlights")
        .select("account_id, period, draft_text, published_text, status, published_at")
        .eq("account_id", accountId!)
        .eq("period", period)
        .maybeSingle();

      if (error) throw error;
      return (data as HighlightDraft | null) ?? null;
    },
  });
}

/**
 * Strategist authoring mutations for a single (account, period).
 *
 * - generateDraft: calls the existing `client-insights` edge function to get
 *   AI-drafted plain-English sentences, joins them into a markdown narrative,
 *   and upserts that as draft_text (status='draft') on the UNIQUE
 *   (account_id, period) row.
 * - saveDraft: persists strategist edits to draft_text.
 * - publish: copies draft_text -> published_text, sets status='published' and
 *   published_at=now().
 */
export function useHighlightMutations(opts: { accountId?: string; period: string }) {
  const { accountId, period } = opts;
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["highlight-draft", accountId, period] });
    queryClient.invalidateQueries({ queryKey: ["published-highlight", accountId, period] });
  };

  const generateDraft = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error("No account selected");

      const { data, error } = await supabase.functions.invoke("client-insights", {
        body: { accountId },
      });
      if (error) throw error;

      const insights: string[] = Array.isArray(data?.insights) ? data.insights : [];
      const draftText = insights.map((s) => `- ${s}`).join("\n");

      const { error: upsertError } = await supabase
        .from("client_highlights")
        .upsert(
          {
            account_id: accountId,
            period,
            draft_text: draftText,
            status: "draft",
          },
          { onConflict: "account_id,period" },
        );
      if (upsertError) throw upsertError;

      return draftText;
    },
    onSuccess: invalidate,
  });

  const saveDraft = useMutation({
    mutationFn: async (text: string) => {
      if (!accountId) throw new Error("No account selected");

      const { error } = await supabase
        .from("client_highlights")
        .upsert(
          {
            account_id: accountId,
            period,
            draft_text: text,
            status: "draft",
          },
          { onConflict: "account_id,period" },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const publish = useMutation({
    mutationFn: async (text: string) => {
      if (!accountId) throw new Error("No account selected");

      const { error } = await supabase
        .from("client_highlights")
        .upsert(
          {
            account_id: accountId,
            period,
            draft_text: text,
            published_text: text,
            status: "published",
            published_at: new Date().toISOString(),
          },
          { onConflict: "account_id,period" },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { generateDraft, saveDraft, publish };
}
