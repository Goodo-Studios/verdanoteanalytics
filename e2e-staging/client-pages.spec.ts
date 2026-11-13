/**
 * OS-019 client pages on the deployed staging site, as client-a@staging.verdanote.test. Read only:
 * it never approves, requests changes or comments. The home leads with one item (or the calm
 * "nothing needs you" card); Briefs, Review and Assets render with no console error and show no
 * internal field labels.
 */
import { test, expect } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, storagePath, watchConsole } from "./support";

// Labels that only appear when an internal field leaks onto a client page.
const INTERNAL_LABELS = [/strategist/i, /producer/i, /\beditor\b/i, /\bhooks\b/i, /QA checklist/i, /stuck/i, /internal/i, /ClickUp/i, /assignee/i];
// Text the client or our team wrote (titles, brief text, comments) is left out: a brief may well
// mention hooks or an editor. Only the page's own labels are checked.
const CONTENT_IDS = ["client-card-title", "client-next-title", "client-brief-text", "client-comment"];

async function expectNoInternalLabels(page: import("@playwright/test").Page, testId: string) {
  const text = await page.getByTestId(testId).evaluate((el, ids) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const id of ids) copy.querySelectorAll(`[data-testid="${id}"]`).forEach((n) => n.remove());
    return copy.textContent ?? "";
  }, CONTENT_IDS);
  for (const re of INTERNAL_LABELS) expect(text, `found ${re} on ${testId}`).not.toMatch(re);
}

test.describe("client: home, Briefs, Review and Assets", () => {
  test.use({ storageState: storagePath("client") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("home leads with one item or the calm empty card", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/client/");
    const lead = page.getByTestId("client-home-lead");
    // A client with no ad account is sent to the pipeline, as before this story.
    await expect(lead.or(page.getByTestId("pipeline-cycle").first()).or(page.getByTestId("pipeline-empty"))).toBeVisible();
    if (await lead.isVisible()) {
      await expect(page.getByTestId("client-next-item").or(page.getByTestId("client-next-none"))).toHaveCount(1);
      await expectNoInternalLabels(page, "client-home-lead");
    }
    await page.waitForLoadState("networkidle");
    expect(watch.problems()).toEqual([]);
  });

  for (const [path, pageId, cardId] of [
    ["/client/brief-review", "client-briefs-page", "client-brief-card"],
    ["/client/review", "client-review-page", "client-review-card"],
    ["/client/assets", "client-assets-page", "client-asset-row"],
  ] as const) {
    test(`${path} renders with no console error and no internal labels`, async ({ page }) => {
      const watch = watchConsole(page);
      await page.goto(path);
      await expect(page.getByTestId(pageId)).toBeVisible();
      await expect(page.getByTestId(cardId).first().or(page.getByTestId("empty-state"))).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoInternalLabels(page, pageId);
      expect(watch.problems()).toEqual([]);
    });
  }

  test("asset download links open the asset URL", async ({ page }) => {
    await page.goto("/client/assets");
    await expect(page.getByTestId("client-assets-page")).toBeVisible();
    const links = page.getByTestId("client-asset-row").getByRole("link", { name: "Download" });
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      await expect(links.nth(i)).toHaveAttribute("href", /^https?:\/\//);
      await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    }
  });
});
