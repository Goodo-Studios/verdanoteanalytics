import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ConversationSummary {
  id: string;
  preview: string;
  created_at: string;
  account_id: string | null;
}

function extractPreview(messages: any): string {
  if (!Array.isArray(messages) || messages.length === 0) return "New conversation";
  const first = messages.find((m: any) => m.role === "user");
  const text = first?.content || "New conversation";
  return text.length > 50 ? text.slice(0, 50) + "…" : text;
}

export function useAIChatHistory() {
  const queryClient = useQueryClient();

  const query = useQuery<ConversationSummary[]>({
    queryKey: ["ai-chat-history"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("ai_conversations")
        .select("id, messages, created_at, account_id")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []).map((c: any) => ({
        id: c.id,
        preview: extractPreview(c.messages),
        created_at: c.created_at,
        account_id: c.account_id,
      }));
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ai-chat-history"] });

  return { ...query, invalidate };
}
