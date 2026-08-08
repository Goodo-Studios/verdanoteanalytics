// Quick-add plumbing — the iOS side of phone capture (US-004).
//
// Sibling of shareTarget.ts, and it exists for the same reason: the constants
// and browser-environment checks around the page belong next to each other and
// outside the component file, so App.tsx, LoginPage's return path, and the tests
// all read one definition.
//
// Why iOS needs a page of its own: Apple has never implemented the Web Share
// Target API, so Safari ignores the manifest's `share_target` entirely. There is
// no OS hook to register — the entry point has to be a home-screen icon the user
// adds through Safari's Share menu, pointing at QUICK_ADD_PATH.

/** The route path in App.tsx, and what an iOS home-screen icon bookmarks. */
export const QUICK_ADD_PATH = "/capture/quick-add";

/** The one-time onboarding line — the only iOS-specific instruction that matters. */
export const ADD_TO_HOME_SCREEN_TIP =
  "Add to Home Screen from Safari's Share menu for one-tap access next time.";

/**
 * What the photo button accepts. Video is included because the shared capture
 * service accepts it (US-002) and a saved screen recording is a real vault item.
 *
 * Deliberately no `capture` attribute: that would force the camera and drop the
 * photo library, which is where a screenshot of someone else's ad actually lives.
 */
export const CAPTURE_FILE_ACCEPT = "image/*,video/*";

/**
 * True when `path` must be reached by a full document load rather than a
 * client-side route change.
 *
 * QUICK_ADD_PATH is served by its own HTML document (capture/quick-add.html),
 * which — unlike index.html — links no web app manifest. That is what lets iOS
 * Safari's Add to Home Screen bookmark this URL instead of building a web app
 * from the manifest's start_url ("/"). A React Router navigation would leave
 * the browser on whatever document it already loaded (index.html, manifest and
 * all), so the icon would once again point at the site root.
 *
 * Deliberately narrow: only the quick-add page has a document of its own, so
 * only the quick-add path pays the cost of a full reload.
 */
export function requiresDocumentNavigation(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0];
  return pathname === QUICK_ADD_PATH;
}

/** Remembers a dismissed tip across visits (device-scoped, hence localStorage). */
const TIP_DISMISSED_KEY = "verdanote:quick-add-tip-dismissed";

/**
 * True when the app is already running from a home-screen icon.
 *
 * `navigator.standalone` is the iOS signal; `display-mode: standalone` covers
 * every other installed context. Either way the onboarding tip would be telling
 * the user to do something they have already done.
 */
export function isStandaloneLaunch(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const installedDisplayMode =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return iosStandalone || installedDisplayMode;
}

/** Show the tip until it is dismissed — storage access can throw, so guard it. */
export function shouldShowHomeScreenTip(): boolean {
  if (isStandaloneLaunch()) return false;
  try {
    return localStorage.getItem(TIP_DISMISSED_KEY) !== "1";
  } catch {
    return true;
  }
}

export function rememberTipDismissed(): void {
  try {
    localStorage.setItem(TIP_DISMISSED_KEY, "1");
  } catch {
    // Private mode / quota: the tip reappears next visit, which is harmless.
  }
}
