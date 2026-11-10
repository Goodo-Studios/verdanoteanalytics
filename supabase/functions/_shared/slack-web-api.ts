// Slack Web API client for reminders and owner alerts.
//
// Port of goodo-os backend/connectors/slack/webApi.ts. Plain fetch against
// https://slack.com/api/<method>, form-encoded POST, bot token in the
// Authorization header only. Rate limits answer HTTP 429 with Retry-After in
// seconds. chat.postMessage is never retried here: Slack has no idempotency key
// for it, so the job queue decides what happens after an unclear answer.
//
// Nothing returned or thrown carries the token or the message text: outcomes
// carry the Slack method name and Slack's error code only.

export type SlackFetch = (input: string, init: RequestInit) => Promise<Response>;

export type SlackCallOutcome =
  | { kind: "ok"; body: Record<string, unknown> }
  /** Slack answered ok:false with a definite error: the call had no effect. */
  | { kind: "rejected"; error: string }
  /** HTTP 429 or a ratelimited error: no effect; retry after the delay. */
  | { kind: "rate_limited"; retryAfterMs: number }
  /** No definite answer. For a write the message may or may not exist. */
  | { kind: "unknown"; reason: string };

export const SLACK_API_BASE_URL = "https://slack.com/api";

const UNCERTAIN_ERRORS = new Set(["internal_error", "fatal_error", "service_unavailable", "request_timeout"]);
const RATE_LIMIT_ERRORS = new Set(["ratelimited", "rate_limited"]);
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;

export interface SlackWebApiOptions {
  token: string;
  fetch?: SlackFetch;
  timeoutMs?: number;
}

export function retryAfterMs(header: string | null): number {
  const seconds = header === null ? NaN : Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.ceil(seconds * 1000), 3_600_000) : 60_000;
}

export function createSlackWebApi(options: SlackWebApiOptions) {
  if (typeof options.token !== "string" || !options.token.trim()) throw new Error("Slack bot token is required");
  const token = options.token.trim();
  const fetcher: SlackFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function callOnce(method: string, params: Record<string, string | number | boolean | undefined>): Promise<SlackCallOutcome> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) body.set(key, String(value));
    let response: Response;
    try {
      response = await fetcher(`${SLACK_API_BASE_URL}/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error && /^(AbortError|TimeoutError)$/.test(error.name) ? "timeout" : "network_error";
      return { kind: "unknown", reason: `${method}:${name}` };
    }
    if (response.status === 429) {
      await response.body?.cancel();
      return { kind: "rate_limited", retryAfterMs: retryAfterMs(response.headers.get("retry-after")) };
    }
    if (response.status >= 500) {
      await response.body?.cancel();
      return { kind: "unknown", reason: `${method}:http_${response.status}` };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { kind: "unknown", reason: `${method}:malformed_response` };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "unknown", reason: `${method}:malformed_response` };
    const result = parsed as Record<string, unknown>;
    if (response.status !== 200) return { kind: "unknown", reason: `${method}:http_${response.status}` };
    if (result.ok === true) return { kind: "ok", body: result };
    const error = typeof result.error === "string" && ERROR_CODE.test(result.error) ? result.error : "unrecognized_error";
    if (RATE_LIMIT_ERRORS.has(error)) return { kind: "rate_limited", retryAfterMs: retryAfterMs(response.headers.get("retry-after")) };
    if (UNCERTAIN_ERRORS.has(error)) return { kind: "unknown", reason: `${method}:${error}` };
    return { kind: "rejected", error };
  }

  return {
    /** chat.postMessage. Never retried. */
    postMessage(channel: string, text: string) {
      return callOnce("chat.postMessage", { channel, text, unfurl_links: false, unfurl_media: false });
    },
    toJSON() {
      return { baseUrl: SLACK_API_BASE_URL };
    },
  };
}
