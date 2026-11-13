// Progress bar figures (OS-025). Pure helpers for src/components/ProgressBar.tsx and its callers.

export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** Where today falls along a month, 0 to 100. Day 1 sits near the start, the last day at the end. */
export function monthPosition(today: Date): number {
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return Math.round((today.getDate() / days) * 1000) / 10;
}

/** The client hub header line, for example "3 of 8 assets delivered". */
export function deliveredText(delivered: number, total: number): string {
  return `${delivered} of ${total} ${total === 1 ? "asset" : "assets"} delivered`;
}
