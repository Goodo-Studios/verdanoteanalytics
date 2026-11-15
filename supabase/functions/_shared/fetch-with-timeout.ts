// fetch with a hard timeout, a small retry for 429 and 5xx, and an optional response size cap.
//
// Edge functions call third parties (Anthropic, OpenRouter, ClickUp, Meta). A bare fetch has no
// timeout, so one stalled upstream pins the whole invocation until the platform kills it.
//
//   const res = await fetchWithTimeout(url, { method: "POST", body }, { timeoutMs: 30_000 });

export interface FetchOptions {
  /** Per attempt limit. Default 15 s. */
  timeoutMs?: number;
  /** Extra attempts after the first for 429, 5xx and network errors. Default 2. */
  retries?: number;
  /** First retry delay; doubles each attempt. A Retry-After header (seconds) wins, capped at maxBackoffMs. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** When set, a response larger than this many bytes throws FetchTooLargeError instead of being read. */
  maxBytes?: number;
  /** Test seams. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class FetchTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Response larger than ${maxBytes} bytes`);
    this.name = "FetchTooLargeError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelay(res: Response | null, attempt: number, backoffMs: number, maxBackoffMs: number): number {
  const ra = res?.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, maxBackoffMs);
  }
  return Math.min(backoffMs * 2 ** attempt, maxBackoffMs);
}

/** Reads the body up to maxBytes and returns a fresh Response, or throws FetchTooLargeError. */
async function capBody(res: Response, maxBytes: number): Promise<Response> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new FetchTooLargeError(maxBytes);
  }
  const reader = res.body?.getReader();
  if (!reader) return res;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.byteLength;
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  opts: FetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 15_000,
    retries = 2,
    backoffMs = 500,
    maxBackoffMs = 5_000,
    maxBytes,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response | null = null;
    try {
      const signal = init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
      res = await fetchImpl(input, { ...init, signal });
    } catch (e) {
      // Caller aborts are not retried; timeouts and network errors are.
      if (init.signal?.aborted) throw e;
      lastError = e;
      if (attempt === retries) throw e;
      await sleep(retryDelay(null, attempt, backoffMs, maxBackoffMs));
      continue;
    }
    if (isRetryableStatus(res.status) && attempt < retries) {
      await res.body?.cancel().catch(() => {});
      await sleep(retryDelay(res, attempt, backoffMs, maxBackoffMs));
      continue;
    }
    return maxBytes === undefined ? res : await capBody(res, maxBytes);
  }
  throw lastError ?? new Error("fetchWithTimeout: no response");
}
