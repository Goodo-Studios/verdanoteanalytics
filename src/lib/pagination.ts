/**
 * Page number to show once the total is known (audit plan item 7.2). A page past the end
 * (the list shrank, for example after narrowing the date range) becomes the last real page;
 * an empty list is page 0.
 */
export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return Math.min(Math.max(page, 0), totalPages - 1);
}
