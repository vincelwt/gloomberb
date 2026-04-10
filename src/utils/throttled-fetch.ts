/**
 * Rate-limited fetch with per-host throttling, retry with backoff, and request deduplication.
 *
 * Usage:
 *   const client = createThrottledFetch({ requestsPerMinute: 30 });
 *   const data = await client.fetch("https://api.example.com/data");
 */

const DEFAULT_REQUESTS_PER_MINUTE = 30;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 1_000;

export interface ThrottledFetchOptions {
  /** Max requests per minute per host. Default: 30 */
  requestsPerMinute?: number;
  /** Max retries on 429 or 5xx. Default: 2 */
  maxRetries?: number;
  /** Request timeout in ms. Default: 10000 */
  timeoutMs?: number;
  /** Default headers applied to every request */
  defaultHeaders?: Record<string, string>;
}

interface QueueEntry {
  resolve: (value: Response) => void;
  reject: (reason: unknown) => void;
  url: string;
  init: RequestInit | undefined;
  retries: number;
}

export interface ThrottledFetchClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T>;
}

export function createThrottledFetch(options: ThrottledFetchOptions = {}): ThrottledFetchClient {
  const requestsPerMinute = options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultHeaders = options.defaultHeaders ?? {};

  // Sliding window: track timestamps of recent requests per host
  const hostTimestamps = new Map<string, number[]>();

  // Deduplication: in-flight requests by URL
  const inflight = new Map<string, Promise<Response>>();

  function getHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return "unknown";
    }
  }

  function getDelayMs(host: string): number {
    const timestamps = hostTimestamps.get(host);
    if (!timestamps || timestamps.length === 0) return 0;

    const windowStart = Date.now() - 60_000;
    // Prune old entries
    while (timestamps.length > 0 && timestamps[0]! < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length < requestsPerMinute) return 0;

    // Delay until the oldest request in the window falls outside
    const oldest = timestamps[0]!;
    return Math.max(0, oldest + 60_000 - Date.now() + 50); // +50ms buffer
  }

  function recordRequest(host: string): void {
    let timestamps = hostTimestamps.get(host);
    if (!timestamps) {
      timestamps = [];
      hostTimestamps.set(host, timestamps);
    }
    timestamps.push(Date.now());
  }

  async function executeRequest(url: string, init: RequestInit | undefined, retriesLeft: number): Promise<Response> {
    const host = getHost(url);

    // Wait for rate limit window
    const delay = getDelayMs(host);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    recordRequest(host);

    const mergedInit: RequestInit = {
      ...init,
      headers: { ...defaultHeaders, ...(init?.headers as Record<string, string> ?? {}) },
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    };

    const resp = await fetch(url, mergedInit);

    // Retry on 429 or 5xx
    if ((resp.status === 429 || resp.status >= 500) && retriesLeft > 0) {
      const attempt = maxRetries - retriesLeft + 1;
      const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      // Respect Retry-After header if present
      const retryAfter = resp.headers.get("retry-after");
      const retryMs = retryAfter ? (parseInt(retryAfter, 10) || 0) * 1000 : backoff;
      const waitMs = Math.max(retryMs, backoff);

      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return executeRequest(url, init, retriesLeft - 1);
    }

    return resp;
  }

  function throttledFetch(url: string, init?: RequestInit): Promise<Response> {
    // Deduplicate concurrent GET requests to the same URL
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      const existing = inflight.get(url);
      if (existing) return existing;
    }

    const promise = executeRequest(url, init, maxRetries).finally(() => {
      inflight.delete(url);
    });

    if (method === "GET") {
      inflight.set(url, promise);
    }

    return promise;
  }

  async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const resp = await throttledFetch(url, init);
    if (!resp.ok) {
      throw new Error(resp.status === 429
        ? `Rate limited (${getHost(url)}) — try again later`
        : `HTTP ${resp.status} from ${getHost(url)}`);
    }
    return resp.json() as Promise<T>;
  }

  return { fetch: throttledFetch, fetchJson };
}
