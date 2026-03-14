import { useState, useCallback, createContext, useContext } from "react";

type PreviewRole = "client" | "employee" | null;

interface ClientPreviewContextType {
  isClientPreview: boolean;
  isEmployeePreview: boolean;
  previewRole: PreviewRole;
  toggleClientPreview: () => void;
  exitClientPreview: () => void;
  setPreviewRole: (role: PreviewRole) => void;
}

export const ClientPreviewContext = createContext<ClientPreviewContextType>({
  isClientPreview: false,
  isEmployeePreview: false,
  previewRole: null,
  toggleClientPreview: () => {},
  exitClientPreview: () => {},
  setPreviewRole: () => {},
});

export function useClientPreviewMode() {
  const [previewRole, setPreviewRoleState] = useState<PreviewRole>(null);
  const isClientPreview = previewRole === "client";
  const isEmployeePreview = previewRole === "employee";
  const toggleClientPreview = useCallback(() => setPreviewRoleState(p => p === "client" ? null : "client"), []);
  const exitClientPreview = useCallback(() => setPreviewRoleState(null), []);
  const setPreviewRole = useCallback((role: PreviewRole) => setPreviewRoleState(role), []);
  return { isClientPreview, isEmployeePreview, previewRole, toggleClientPreview, exitClientPreview, setPreviewRole };
}

export function useClientPreview() {
  return useContext(ClientPreviewContext);
}
