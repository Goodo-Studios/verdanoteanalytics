import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

export function useApiKeys() {
  return useQuery<ApiKey[]>({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, permissions, last_used_at, is_active, created_at, expires_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ApiKey[];
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, scopes }: { name: string; scopes: string[] }): Promise<string> => {
      // Generate a secure random key: vdn_ prefix + 24 random hex chars
      const randomBytes = new Uint8Array(12);
      crypto.getRandomValues(randomBytes);
      const randomHex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");
      const apiKey = `vdn_${randomHex}`;

      const { data, error } = await supabase.rpc("create_api_key", {
        key_name: name,
        api_key: apiKey,
      });
      if (error) throw error;

      // Update permissions to the selected scopes
      if (data && scopes.length > 0) {
        await supabase
          .from("api_keys")
          .update({ permissions: scopes } as any)
          .eq("id", data);
      }

      return apiKey; // Return the plaintext key (only shown once)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to create API key");
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("api_keys")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key revoked");
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to revoke API key");
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("api_keys")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key deleted");
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to delete API key");
    },
  });
}
