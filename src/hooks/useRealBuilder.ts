import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";

/** True for a builder who is not previewing the client or employee view. */
export function useRealBuilder(): boolean {
  const { isBuilder } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  return isBuilder && !isClientPreview && !isEmployeePreview;
}
