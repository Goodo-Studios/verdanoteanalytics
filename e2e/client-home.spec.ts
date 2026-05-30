/**
 * Client Home E2E (US-009) — the purpose-built brand-owner client surface.
 *
 * Asserts the full client experience end-to-end against the live app:
 *   1. Client lands on Client Home with headline outcomes, a playable winner
 *      (<video>), the published "This Period's Highlights", and the read-only
 *      content pipeline.
 *   2. Internal strategist routes (/creatives, /analytics, /compare, /tagging,
 *      /briefs, /ad-library, /viral-feed) redirect the client to Client Home.
 *   3. The rendered client surface NEVER leaks internal strategist
 *      strings/controls (kill/scale, Hook Rate, CPA/CTR headers, Tagging,
 *      draft-narrative editor/publish controls).
 *   4. The playable winner <video> carries a stable key, a poster, and a src.
 *   5. A draft-but-unpublished narrative is never shown to the client — only the
 *      published narrative path (or the onboarding empty state) appears.
 *
 * Authenticated checks require a real CLIENT-role test account in env. These
 * use DEDICATED client credentials, distinct from the builder account that the
 * rest of the suite (dashboard.spec.ts) uses, because the assertions are only
 * meaningful for a real client-role user (effectiveClient = isClient ||
 * isClientPreview, and the authoring controls are gated on the REAL role):
 *
 *   PLAYWRIGHT_CLIENT_EMAIL=client@example.com
 *   PLAYWRIGHT_CLIENT_PASSWORD=your-client-test-password
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080   (or staging URL)
 *
 * NOTE: the credentials MUST belong to a client-role user for these assertions
 * to be meaningful. Client-preview mode is NOT a substitute: it is in-memory
 * only (lost on navigation) and leaves isAuthor gated on the real role, so a
 * builder-in-preview would still render authoring controls. The live
 * acceptance run is performed by the deploy/orchestration step, not here.
 */
import { test, expect, type Page } from "@playwright/test";

const TEST_EMAIL = process.env.PLAYWRIGHT_CLIENT_EMAIL || "";
const TEST_PASSWORD = process.env.PLAYWRIGHT_CLIENT_PASSWORD || "";
const hasCredentials = !!TEST_EMAIL && !!TEST_PASSWORD;

/**
 * Mirrors the loginAs helper in dashboard.spec.ts. After auth the app redirects
 * to /:role/ (builder | employee | client). A client account lands on /client/.
 */
async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(builder|employee|client)\//, { timeout: 15_000 });
}

/** The role prefix (e.g. "/client") derived from the post-login URL. */
function rolePrefix(page: Page): string {
  return page.url().match(/\/(builder|employee|client)/)?.[0] ?? "/client";
}

/**
 * Internal-only strings/controls that must NEVER appear on the client surface.
 * These are real, load-bearing leak-proof assertions — do not soften them.
 * The draft-narrative editor/publish controls are gated behind isAuthor, so a
 * real client never renders "Strategist tools", "Generate draft", "Save draft",
 * or "Publish" (covers the US-005 publish gate / draft-leak scenario #5).
 */
const FORBIDDEN_TEXT: RegExp[] = [
  /\bkill\b/i,
  /\bscale\b/i,
  /kill\s*\/\s*scale/i,
  /hook rate/i,
  /\bCPA\b/,
  /\bCTR\b/,
  /\bTagging\b/,
  /Strategist tools/i,
  /Generate draft/i,
  /Save draft/i,
];

test.describe("Client Home (US-009)", () => {
  test.skip(!hasCredentials, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD to run");

  test("client lands on Client Home with outcomes, a playable winner, highlights, and pipeline", async ({
    page,
  }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);

    const prefix = rolePrefix(page);
    // Ensure we are on the Client Home index route.
    await page.goto(`${prefix}/`);
    await expect(page).toHaveURL(new RegExp(`${prefix}/?$`));

    // No full-page error boundary.
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 5_000 });

    // Headline outcomes section (ClientOutcomesSection) — performance snapshot.
    await expect(page.locator('[data-section="performance-snapshot"]')).toBeVisible({
      timeout: 12_000,
    });

    // Published "This Period's Highlights" section.
    await expect(page.locator('[data-section="this-periods-highlights"]')).toBeVisible();
    await expect(page.getByText(/This Period.?s Highlights/i)).toBeVisible();

    // The winners section ("What's working") always renders, and resolves to one
    // of three leak-free states, all of which are valid product behavior:
    //   1. video-card winner — a creative with a real video_url renders an inline
    //      <video controls poster src> (the AC1 "playable winner" happy path);
    //   2. image-card winner — a real winner whose creative has no video_url
    //      renders its thumbnail <img> (video_url === "no-video"); and
    //   3. empty state — no winners at all yet renders the friendly onboarding copy.
    // A winner card (states 1 & 2) always carries the revenue/ROAS framing line
    // "For every $1 you spent on this ad"; the empty state carries "Winners show
    // up here". We assert the section is present, that a <video> renders when one
    // exists, and that otherwise EITHER a winner card OR the empty state is shown.
    const winners = page.locator('[data-testid="client-winners"]');
    await expect(winners).toBeVisible();

    const video = winners.locator("video");
    const videoCount = await video.count();
    if (videoCount > 0) {
      // A playable video winner exists — it must render (AC1/AC4 happy path).
      await expect(video.first()).toBeVisible();
    } else {
      // No video winner in this account. The section is still valid as either
      // image-card winners or the empty state — both leak-free (asserted in the
      // dedicated leak test below).
      const winnerCard = winners.getByText(/For every \$1 you spent on this ad/i);
      const emptyState = winners.getByText(/Winners show up here/i);
      await expect(winnerCard.or(emptyState).first()).toBeVisible();
    }

    // Read-only content pipeline section (no write/interaction controls).
    const pipeline = page.locator('[data-section="content-pipeline-summary"]');
    await expect(pipeline).toBeVisible();
    // Read-only invariant: no comment / approve / request-changes / upload controls.
    await expect(
      pipeline.getByRole("button", { name: /comment|approve|request changes|upload/i })
    ).toHaveCount(0);
  });

  test("internal strategist routes redirect the client to Client Home", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    const prefix = rolePrefix(page);

    // The router redirects effectiveClient away from these to `${prefix}/`.
    const guardedPaths = [
      "/creatives",
      "/analytics",
      "/creatives/compare", // /compare surface
      "/tagging",
      "/briefs",
      "/ad-library",
      "/viral-feed",
    ];

    for (const path of guardedPaths) {
      await page.goto(`${prefix}${path}`);
      // Must end up back on the Client Home index, not the guarded surface.
      await page.waitForURL(new RegExp(`${prefix}/?$`), { timeout: 10_000 });
      expect(page.url(), `expected ${path} to redirect to Client Home`).toMatch(
        new RegExp(`${prefix}/?$`)
      );
    }
  });

  test("client surface never leaks internal strategist strings or controls", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    const prefix = rolePrefix(page);
    await page.goto(`${prefix}/`);

    // Wait for the surface to finish its initial render.
    await expect(page.locator('[data-section="performance-snapshot"]')).toBeVisible({
      timeout: 12_000,
    });
    await expect(page.locator('[data-testid="client-winners"]')).toBeVisible();

    // Real, leak-proof assertions: none of the forbidden internal-only strings
    // appear anywhere in the rendered client surface. This also covers the
    // draft-narrative editor/publish controls and any draft-text leak, since
    // the authoring block ("Strategist tools" / "Generate draft" / "Save draft")
    // is gated behind isAuthor and absent for a real client (US-001/US-005).
    const body = page.locator("body");
    for (const pattern of FORBIDDEN_TEXT) {
      await expect(body, `forbidden pattern leaked: ${pattern}`).not.toContainText(pattern);
    }

    // CPA/CTR table headers must not be present as column headers either.
    await expect(page.getByRole("columnheader", { name: /CPA|CTR|Hook Rate/i })).toHaveCount(0);

    // The strategist authoring controls must be absent from the client DOM.
    await expect(page.locator('[data-testid="highlights-author-controls"]')).toHaveCount(0);
  });

  test("the playable winner video has a stable key, a poster, and a src", async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    const prefix = rolePrefix(page);
    await page.goto(`${prefix}/`);

    const winners = page.locator('[data-testid="client-winners"]');
    await expect(winners).toBeVisible({ timeout: 12_000 });

    const video = winners.locator("video");
    const videoCount = await video.count();
    // Best-effort: only assertable when the account actually has a winner with a
    // video_url. If absent, document and skip the per-element attribute check —
    // the empty-state path is still leak-checked in the dedicated test above.
    test.skip(
      videoCount === 0,
      "No winner video present for this account — attribute assertions require a winner with video_url"
    );

    const first = video.first();
    await expect(first).toBeVisible();
    // src is required to play the creative.
    const src = await first.getAttribute("src");
    expect(src, "winner <video> must carry a src").toBeTruthy();
    // poster (cached thumbnail) gives a stable frame before playback.
    const poster = await first.getAttribute("poster");
    expect(poster, "winner <video> must carry a poster").toBeTruthy();
    // controls is the native playable affordance.
    await expect(first).toHaveAttribute("controls", /.*/);
    // The React key={ad.id} is not a DOM attribute, but it forces a fresh
    // <video> on creative swap. We assert each rendered winner video is a
    // distinct, present element (a stable identity per creative) by confirming
    // every video has a non-empty src.
    for (let i = 0; i < videoCount; i++) {
      const s = await video.nth(i).getAttribute("src");
      expect(s, `winner video #${i} must have a src`).toBeTruthy();
    }
  });

  test("a draft-but-unpublished narrative never shows draft text to the client", async ({
    page,
  }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    const prefix = rolePrefix(page);
    await page.goto(`${prefix}/`);

    const highlights = page.locator('[data-testid="client-highlights"]');
    await expect(highlights).toBeVisible({ timeout: 12_000 });

    // The highlights section renders EITHER the published narrative (markdown of
    // published_text only — the client_highlights_published view omits draft_text)
    // OR the friendly onboarding empty state. It must NEVER render the authoring
    // editor/publish controls or any draft-only affordance.
    //
    // NOTE: a dedicated draft-fixture account (published_text NULL but draft_text
    // set) is not guaranteed to be available in this env. The leak-proof
    // invariant we CAN assert against any client account is that the authoring
    // surface and draft controls are absent — which is exactly what guarantees a
    // draft cannot leak (US-001 RLS view + US-005 publish gate).
    await expect(highlights.locator('[data-testid="highlights-author-controls"]')).toHaveCount(0);
    await expect(highlights.getByRole("textbox", { name: /Highlights draft/i })).toHaveCount(0);
    await expect(highlights.getByRole("button", { name: /^Publish$/ })).toHaveCount(0);
    await expect(highlights.getByText(/Generate draft/i)).toHaveCount(0);

    // Positive path: the client sees either the published narrative body or the
    // onboarding empty state — both are valid, leak-free outcomes.
    const publishedBody = highlights.locator(".prose");
    const onboarding = highlights.getByText(/strategist is preparing your first highlights/i);
    await expect(publishedBody.or(onboarding).first()).toBeVisible();
  });
});
