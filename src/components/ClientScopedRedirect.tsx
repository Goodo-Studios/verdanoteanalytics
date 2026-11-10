import { Navigate, useLocation } from "react-router-dom";
import { slugFromLocation, useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRolePrefix } from "@/hooks/useRolePath";
import { resolveClientScopedRoute } from "@/lib/clientHub";

/**
 * Old address of a page that now lives inside the client hub. Goes to that tab for the client named
 * by ?client= or ?brand= (old links), else the client in the switcher, else the client list. The
 * ?client= and ?brand= parameters are dropped: the client is in the new address.
 */
export function ClientScopedRedirect({ from }: { from: string }) {
  const prefix = useRolePrefix();
  const { pathname, search } = useLocation();
  const { selectedSlug } = useClientSelection();
  const slug = slugFromLocation(pathname, search).slug ?? selectedSlug;
  const params = new URLSearchParams(search);
  params.delete("client");
  params.delete("brand");
  const qs = params.toString();
  const target = resolveClientScopedRoute(from, slug) ?? "/clients";
  return <Navigate to={`${prefix}${target}${qs ? `?${qs}` : ""}`} replace />;
}
