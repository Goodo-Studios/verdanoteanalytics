// Service worker registration for PWA installability.
//
// The worker itself (src/sw.ts) is a pass-through — see that file for why it
// exists at all. This module only handles registration, and is kept free of
// module-level side effects so it can be unit tested without a real browser.

/** Build output path of the compiled worker (see `build.rollupOptions` in vite.config.ts). */
export const SERVICE_WORKER_URL = "/sw.js";

/** Root scope so the worker also covers the mobile capture routes under /capture/*. */
export const SERVICE_WORKER_SCOPE = "/";

export type ServiceWorkerRegistrationResult =
  | { status: "registered"; registration: ServiceWorkerRegistration }
  | { status: "skipped"; reason: "disabled" | "unsupported" }
  | { status: "failed"; error: unknown };

export interface RegisterServiceWorkerOptions {
  /**
   * Registration target. Defaults to `navigator.serviceWorker`, which is absent
   * on insecure origins and in non-browser environments.
   */
  container?: ServiceWorkerContainer | undefined;
  /**
   * Whether registration should happen at all. Defaults to "not a dev build":
   * the compiled worker only exists in build output, so registering against the
   * Vite dev server would 404 on every reload.
   */
  enabled?: boolean;
}

/**
 * Register the pass-through service worker.
 *
 * Never throws — a failed registration degrades the app to a non-installable
 * (but fully functional) web app rather than breaking startup.
 */
export async function registerServiceWorker(
  options: RegisterServiceWorkerOptions = {},
): Promise<ServiceWorkerRegistrationResult> {
  const {
    container = typeof navigator === "undefined" ? undefined : navigator.serviceWorker,
    enabled = !import.meta.env.DEV,
  } = options;

  if (!enabled) {
    return { status: "skipped", reason: "disabled" };
  }

  if (!container || typeof container.register !== "function") {
    return { status: "skipped", reason: "unsupported" };
  }

  try {
    const registration = await container.register(SERVICE_WORKER_URL, {
      scope: SERVICE_WORKER_SCOPE,
    });
    return { status: "registered", registration };
  } catch (error) {
    return { status: "failed", error };
  }
}
