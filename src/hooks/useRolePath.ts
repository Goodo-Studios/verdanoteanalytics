import { useCallback } from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";

/**
 * Returns the URL prefix for the current user's role.
 * e.g. "/builder", "/client", "/employee"
 */
export function useRolePrefix(): string {
  const { role, isClient } = useAuth();
  const { isClientPreview, isEmployeePreview } = useClientPreview();
  if (isClient || isClientPreview) return "/client";
  if (role === "employee" || isEmployeePreview) return "/employee";
  return "/builder";
}

/**
 * Prefixes an absolute path with the role prefix.
 * If the path is relative or already prefixed, returns as-is.
 */
export function prefixPath(prefix: string, path: string): string {
  if (path.startsWith("/builder/") || path.startsWith("/client/") || path.startsWith("/employee/")) return path;
  if (path.startsWith("/builder") || path.startsWith("/client") || path.startsWith("/employee")) return path;
  if (path.startsWith("/")) return `${prefix}${path}`;
  return path;
}

/**
 * Drop-in replacement for useNavigate that auto-prefixes absolute paths
 * with the current user's role prefix (/builder, /client, /employee).
 */
export function useRoleNavigate() {
  const navigate = useNavigate();
  const prefix = useRolePrefix();

  return useCallback(
    (to: string | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      navigate(prefixPath(prefix, to), options);
    },
    [navigate, prefix],
  );
}
