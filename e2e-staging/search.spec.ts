/**
 * Cmd/Ctrl+K content search (OS-015) on the deployed staging site. Read only.
 *
 * As the staging builder: a phrase that appears only in the body of one Brain page finds that page
 * under Pages, with the matching line and the matched words marked, and the os_search round trip
 * is under 300 ms.
 * As the staging client: the palette is staff only, so the client has no Cmd+K. The rule that
 * matters is on the server, so the test calls os_search with the client's own session and checks
 * that a staff Brain page title finds no pages.
 */
import { test, expect, type Page } from "@playwright/test";
import { hasLogins, NEEDS_PASSWORD, openSearchWithShortcut, storagePath, watchConsole } from "./support";

// From the Playbooks page "Editing Style Defaults" (HQ knowledge processes/editing-style-defaults.md),
// in the Creator Concepts text-on-screen rules. The phrase is in that page's body only, not in any title.
const BODY_PHRASE = "sweeping reveals";
const BODY_PAGE_TITLE = "Editing Style Defaults";
// A staff Brain page title, used for the client check.
const STAFF_PAGE_TITLE = "Editing Style Defaults";

const isSearch = (url: string) => url.includes("/rest/v1/rpc/os_search");

/** Types the text and returns the milliseconds from the os_search request to its response. */
async function timedSearch(page: Page, input: ReturnType<Page["getByTestId"]>, text: string): Promise<number> {
  await input.fill("");
  const responsePromise = page.waitForResponse((r) => {
    if (!isSearch(r.url()) || r.request().method() !== "POST") return false;
    return (r.request().postDataJSON() as { p_query?: string } | null)?.p_query === text;
  });
  await input.fill(text);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const timing = response.request().timing();
  // requestStart and responseEnd are relative to startTime; responseEnd is -1 if not known.
  expect(timing.responseEnd).toBeGreaterThan(0);
  return timing.responseEnd - timing.requestStart;
}

test.describe("builder: search page content from Cmd+K", () => {
  test.use({ storageState: storagePath("builder") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("a phrase only in a page body finds the page under Pages, with the matching line, in under 300 ms", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/builder/");
    const input = await openSearchWithShortcut(page);

    // The first, cold query is left out of the timing: it pays for connection setup.
    await timedSearch(page, input, BODY_PHRASE);

    const pages = page.locator('[data-testid="command-palette-group"][data-kind="page"]');
    await expect(pages).toBeVisible();
    await expect(pages.getByText("Pages", { exact: true })).toBeVisible();
    const hit = pages.getByTestId("command-palette-search-item").filter({ hasText: BODY_PAGE_TITLE });
    await expect(hit).toHaveCount(1);
    const snippet = hit.getByTestId("command-palette-snippet");
    await expect(snippet).toContainText(/sweeping reveals/i);
    await expect(snippet.locator("mark").first()).toHaveText(/sweeping/i);

    // Best of three warm queries: one slow network moment should not fail the check, a slow
    // query will still fail all three.
    const warm: number[] = [];
    // Different text each time, so each one is a fresh request.
    for (const text of ["sweeping reveal", BODY_PHRASE, "sweep reveals"]) {
      warm.push(await timedSearch(page, input, text));
    }
    const best = Math.min(...warm);
    test.info().annotations.push({ type: "os_search ms", description: `warm: ${warm.map((n) => Math.round(n)).join(", ")}; best ${Math.round(best)}` });
    expect(best).toBeLessThan(300);

    // Choosing the page opens it in the Brain.
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page).toHaveURL(/\/builder\/knowledge\/brain\?section=Playbooks&page=editing-style-defaults/);
    await expect(page.getByTestId("brain-page")).toBeVisible();
    expect(watch.problems()).toEqual([]);
  });
});

test.describe("client: search", () => {
  test.use({ storageState: storagePath("client") });
  test.skip(!hasLogins, NEEDS_PASSWORD);

  test("a staff Brain page title finds no pages for a client", async ({ page }) => {
    // Pick up the API address and public key from the app's own requests, and the client's session.
    const api = new Promise<{ origin: string; apikey: string }>((resolve) => {
      page.on("request", (r) => {
        const key = r.headers()["apikey"];
        if (key && r.url().includes("/rest/v1/")) resolve({ origin: new URL(r.url()).origin, apikey: key });
      });
    });
    await page.goto("/client/");
    const { origin, apikey } = await api;
    const token = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? "";
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) return (JSON.parse(localStorage.getItem(k) ?? "{}") as { access_token?: string }).access_token ?? "";
      }
      return "";
    });
    expect(token).not.toBe("");

    // No Cmd+K for a client.
    await expect(page.getByTestId("command-palette-button")).toHaveCount(0);

    for (const query of [STAFF_PAGE_TITLE, BODY_PHRASE]) {
      const res = await page.request.post(`${origin}/rest/v1/rpc/os_search`, {
        headers: { apikey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: { p_query: query, p_limit: 8 },
      });
      expect(res.status()).toBe(200);
      const rows = (await res.json()) as Array<{ kind: string }>;
      expect(rows.filter((r) => r.kind === "page"), query).toEqual([]);
    }
  });
});
