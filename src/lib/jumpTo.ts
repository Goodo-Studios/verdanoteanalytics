// What the Cmd/Ctrl+K palette can jump to: every client by name, and every page of the staff menu
// (Home, Work, Clients, and each tab of each section). Pure data and matching, so the list is
// tested without the dialog. Role-relative addresses; the palette adds the role prefix.
import { SECTIONS, tabsFor } from "@/lib/sections";
import { hubPath } from "@/lib/clientHub";

export interface JumpItem {
  id: string;
  kind: "page" | "client";
  /** What is shown. */
  label: string;
  /** Small grey text next to it. */
  hint: string;
  /** Role-relative address. */
  to: string;
  /** Words matched against what the person types. */
  haystack: string;
}

/** Every page a person may open. Builder-only tabs only for a real builder. */
export function pageItems(effectiveBuilder: boolean): JumpItem[] {
  const items: JumpItem[] = [
    { id: "page-home", kind: "page", label: "Home", hint: "Today", to: "/", haystack: "home today" },
    { id: "page-work", kind: "page", label: "Work", hint: "Home", to: "/work", haystack: "work home tasks clickup cards due" },
    { id: "page-clients", kind: "page", label: "Clients", hint: "Menu", to: "/clients", haystack: "clients list" },
  ];
  for (const section of SECTIONS) {
    const tabs = tabsFor(section, effectiveBuilder);
    // A section whose tabs are all hidden from this person (Growth Dashboard for an employee)
    // is not listed at all.
    if (tabs.length === 0) continue;
    items.push({ id: `page-${section.id}`, kind: "page", label: section.label, hint: "Menu", to: `/${section.id}`, haystack: `${section.label} ${section.description}` });
    for (const tab of tabs) {
      items.push({
        id: `page-${section.id}-${tab.slug}`,
        kind: "page",
        label: tab.label,
        hint: section.label,
        to: `/${section.id}/${tab.slug}`,
        haystack: `${tab.label} ${section.label}${tab.group ? ` ${tab.group}` : ""}`,
      });
    }
  }
  return items;
}

export function clientItems(clients: Array<{ slug: string; name: string; active: boolean }>): JumpItem[] {
  return clients.map((c) => ({
    id: `client-${c.slug}`,
    kind: "client" as const,
    label: c.name,
    hint: c.active ? "Client" : "Client (inactive)",
    to: hubPath(c.slug),
    haystack: c.name,
  }));
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** An item matches when every word typed appears in its words. Clients first, then pages. A blank search lists a short start. */
export function searchJump(items: JumpItem[], query: string, limit = 12): JumpItem[] {
  const words = norm(query).split(" ").filter(Boolean);
  const ordered = [...items.filter((i) => i.kind === "client"), ...items.filter((i) => i.kind === "page")];
  if (words.length === 0) {
    const clients = ordered.filter((i) => i.kind === "client").slice(0, 5);
    const pages = ordered.filter((i) => i.kind === "page").slice(0, limit - clients.length);
    return [...clients, ...pages];
  }
  const scored = ordered
    .map((item) => {
      const hay = norm(`${item.label} ${item.haystack}`);
      const label = norm(item.label);
      if (!words.every((w) => hay.includes(w))) return null;
      // A label that starts with what was typed comes first.
      const rank = label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2;
      return { item, rank };
    })
    .filter((x): x is { item: JumpItem; rank: number } => x !== null);
  scored.sort((a, b) => a.rank - b.rank);
  return scored.slice(0, limit).map((x) => x.item);
}
