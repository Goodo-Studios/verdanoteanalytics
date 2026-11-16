// Waits for a list page to finish loading: either its rows or its empty state is on screen.
// Replaces fixed sleeps (audit Batch 9), which failed on a slow load and wasted time on a fast one.
import { expect, type Locator, type Page } from "@playwright/test";

const LIST_TIMEOUT_MS = 20_000;

/** Rows or cards on the Creatives page. */
export function creativeRows(page: Page): Locator {
  return page.locator("tbody tr, [class*='card'][class*='creative']");
}

/** The Creatives page has loaded: a row or card, or one of its empty states (CreativesPage, CreativesTimeline). */
export async function waitForCreativesList(page: Page): Promise<void> {
  const empty = page.getByText(/no creatives yet|no data for this date range|no creatives in this time range/i);
  await expect(creativeRows(page).or(empty).first()).toBeVisible({ timeout: LIST_TIMEOUT_MS });
}

/** The vault Library has loaded: an item card, or its empty or no-results state (features/vault/LibraryPage). */
export async function waitForVaultLibrary(page: Page, cards: Locator): Promise<void> {
  const empty = page.getByText(/no inspiration saved yet\.|no results for/i);
  await expect(cards.or(empty).first()).toBeVisible({ timeout: LIST_TIMEOUT_MS });
}
