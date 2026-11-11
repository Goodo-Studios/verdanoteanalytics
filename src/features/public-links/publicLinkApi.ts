// The browser side of the public-link edge function: what a page opened from a link calls.
// No login and no staff session is involved; the secret in the link is the only credential.
// Answers are reduced to a small set of reasons so a page can say something plain for each.

export type LinkType = "approval" | "casting" | "location" | "call-sheet";

export type LinkFailure = "not_found" | "revoked" | "expired" | "rate_limited" | "invalid" | "too_large" | "error";

export type LinkResult<T> = { ok: true; data: T } | { ok: false; reason: LinkFailure };

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-link`;

export function failureFromStatus(status: number, error: unknown): LinkFailure {
  if (status === 404) return "not_found";
  if (status === 410) return error === "revoked" ? "revoked" : "expired";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid";
  if (status === 413) return "too_large";
  return "error";
}

export async function callPublicLink<T>(body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<LinkResult<T>> {
  try {
    const res = await fetchImpl(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, data: json as T };
    const error = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
    return { ok: false, reason: failureFromStatus(res.status, error) };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** The path a link opens at. Same paths the old dashboard used, so old links redirect one to one. */
export const LINK_PATHS: Record<LinkType, string> = { approval: "/approve/", casting: "/cast/", location: "/locations-board/", "call-sheet": "/call-sheet/" };

/** The full address staff copy and send. It opens on this site. */
export function publicLinkUrl(type: LinkType, token: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, "")}${LINK_PATHS[type]}${token}`;
}

/** The plain sentence for each reason a link page cannot open. */
export const FAILURE_COPY: Record<LinkFailure, { title: string; body: string }> = {
  not_found: { title: "This link is not available", body: "Check that the whole link was copied, or ask your Goodo contact to send it again." },
  revoked: { title: "This link has been turned off", body: "Ask your Goodo contact for a new link." },
  expired: { title: "This link has expired", body: "Ask your Goodo contact for a new link." },
  rate_limited: { title: "That was a lot of tries", body: "Please wait a minute, then try again." },
  invalid: { title: "That did not go through", body: "Please reload the page and try again." },
  too_large: { title: "That was too much to send", body: "Please shorten it and try again." },
  error: { title: "Something went wrong on our side", body: "Please try again in a moment." },
};

/** Only http and https ever become links. */
export function safeHref(url: string | null | undefined): string | null {
  const t = url?.trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  return /^https?:\/\//i.test(withScheme) ? withScheme : null;
}
