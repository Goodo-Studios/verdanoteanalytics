import { useMutation, useQueryClient, type InvalidateQueryFilters } from "@tanstack/react-query";
import { toast } from "sonner";

interface MutationWithToastOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  invalidateKeys?: string[][];
  successMessage?: string | ((data: TData) => string);
  successDescription?: string | ((data: TData) => string | undefined);
  errorMessage?: string;
  /** Skip the error toast; the caller reports failures itself (e.g. one bulk summary). */
  silentError?: boolean;
}

export function useMutationWithToast<TData = any, TVariables = void>({
  mutationFn,
  invalidateKeys = [],
  successMessage,
  successDescription,
  errorMessage = "Something went wrong",
  silentError = false,
}: MutationWithToastOptions<TData, TVariables>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      invalidateKeys.forEach(key => qc.invalidateQueries({ queryKey: key } as InvalidateQueryFilters));
      if (successMessage) {
        const msg = typeof successMessage === "function" ? successMessage(data) : successMessage;
        const desc = typeof successDescription === "function" ? successDescription(data) : successDescription;
        toast.success(msg, desc ? { description: desc } : undefined);
      }
    },
    onError: (e: Error) => {
      if (!silentError) toast.error(errorMessage, { description: e.message });
    },
  });
}
