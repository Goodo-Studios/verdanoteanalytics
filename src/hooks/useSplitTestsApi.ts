import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMutationWithToast } from "./useMutationWithToast";

export interface SplitTest {
  id: string;
  account_id: string;
  name: string;
  hypothesis: string | null;
  variable_tested: string | null;
  status: string;
  winner_ad_id: string | null;
  start_date: string | null;
  end_date: string | null;
  minimum_spend: number;
  notes: string | null;
  created_at: string;
}

export interface SplitTestVariant {
  id: string;
  test_id: string;
  ad_id: string;
  label: string;
}

export function useSplitTests(accountId?: string) {
  return useQuery<SplitTest[]>({
    queryKey: ["split_tests", accountId],
    enabled: !!accountId && accountId !== "all",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("split_tests" as any)
        .select("*")
        .eq("account_id", accountId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SplitTest[];
    },
  });
}

export function useSplitTestVariants(testIds: string[]) {
  return useQuery<SplitTestVariant[]>({
    queryKey: ["split_test_variants", testIds],
    enabled: testIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("split_test_variants" as any)
        .select("*")
        .in("test_id", testIds);
      if (error) throw error;
      return (data || []) as unknown as SplitTestVariant[];
    },
  });
}

export function useCreateSplitTest() {
  return useMutationWithToast({
    mutationFn: async ({
      test,
      variants,
    }: {
      test: Omit<SplitTest, "id" | "created_at">;
      variants: { ad_id: string; label: string }[];
    }) => {
      const { data: testData, error: testError } = await supabase
        .from("split_tests" as any)
        .insert(test as any)
        .select()
        .single();
      if (testError) throw testError;
      const testId = (testData as any).id;

      if (variants.length > 0) {
        const rows = variants.map((v) => ({ test_id: testId, ...v }));
        const { error: varError } = await supabase
          .from("split_test_variants" as any)
          .insert(rows as any);
        if (varError) throw varError;
      }

      return testData;
    },
    invalidateKeys: [["split_tests"], ["split_test_variants"]],
    successMessage: "Test created",
    errorMessage: "Error creating test",
  });
}

export function useUpdateSplitTest() {
  return useMutationWithToast({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<SplitTest>;
    }) => {
      const { data, error } = await supabase
        .from("split_tests" as any)
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    invalidateKeys: [["split_tests"]],
    successMessage: "Test updated",
    errorMessage: "Error updating test",
  });
}

export function useDeleteSplitTest() {
  return useMutationWithToast({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("split_tests" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    invalidateKeys: [["split_tests"], ["split_test_variants"]],
    successMessage: "Test deleted",
    errorMessage: "Error deleting test",
  });
}
