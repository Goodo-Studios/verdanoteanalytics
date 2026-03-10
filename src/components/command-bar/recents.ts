import type { RecentItem } from "./types";

const RECENTS_KEY = "verdanote_cmd_recents";
const MAX_RECENTS = 5;

export function getRecents(): RecentItem[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); }
  catch (e) { console.warn("Failed to parse command bar recents:", e); return []; }
}

export function addRecent(item: Omit<RecentItem, "timestamp">) {
  const recents = getRecents().filter(r => r.id !== item.id);
  recents.unshift({ ...item, timestamp: Date.now() });
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}
