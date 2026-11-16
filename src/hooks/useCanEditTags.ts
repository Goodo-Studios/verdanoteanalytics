import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";

/**
 * True for staff (builder or employee) who are not previewing the client view. Gates the tag
 * editors and Save to Vault: the server refuses tag saves from clients, and a builder in Client
 * Preview should see exactly what a client sees (audit plan item 3.3).
 */
export function useCanEditTags(): boolean {
  const { isBuilder, isEmployee } = useAuth();
  const { isClientPreview } = useClientPreview();
  return (isBuilder || isEmployee) && !isClientPreview;
}
