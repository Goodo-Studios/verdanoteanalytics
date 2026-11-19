// Which clients the top client picker offers on a page. Active clients only; on the creator
// pages (Creator pipeline, Approval boards) only clients that run creators. A client that is
// already selected stays in the list so existing data and links do not break.
import type { SwitcherClient } from "@/contexts/ClientSelectionContext";

const CREATOR_TABS = new Set(["pipeline", "approval-boards"]);

/** True on the Creators section pages that only make sense for clients with does_creators. */
export function isCreatorPickerPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "builder" || parts[0] === "employee" || parts[0] === "client") parts.shift();
  return parts[0] === "talent" && !!parts[1] && CREATOR_TABS.has(parts[1]);
}

export function pickerClients(clients: SwitcherClient[], selectedSlug: string, pathname: string): SwitcherClient[] {
  const creatorsOnly = isCreatorPickerPath(pathname);
  return clients.filter((c) => c.slug === selectedSlug || (c.active && (!creatorsOnly || c.does_creators !== false)));
}
