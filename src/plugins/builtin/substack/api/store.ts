import type { PluginPersistence } from "../../../../types/plugin";
import type { CachePolicy, PersistedResourceValue } from "../../../../types/persistence";
import { createThrottledFetch, type ThrottledFetchTransport } from "../../../../utils/throttled-fetch";
import { normalizedHttpUrl } from "../../../../utils/url";
import { SubstackAuthError, type SubstackAuthState, type SubstackCachedData } from "./types";

export const SUBSTACK_ORIGIN = "https://substack.com";

const AUTH_STATE_KEY = "auth";
const AUTH_SCHEMA_VERSION = 1;
export const CACHE_SOURCE = "substack";
export const CACHE_SCHEMA_VERSION = 3;
const DEFAULT_HEADERS = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};
const CACHE_POLICIES = {
  subscriptions: { staleMs: 30 * 60 * 1000, expireMs: 14 * 24 * 60 * 60 * 1000 },
  feed: { staleMs: 5 * 60 * 1000, expireMs: 3 * 24 * 60 * 60 * 1000 },
  publication: { staleMs: 10 * 60 * 1000, expireMs: 7 * 24 * 60 * 60 * 1000 },
  post: { staleMs: 30 * 24 * 60 * 60 * 1000, expireMs: 365 * 24 * 60 * 60 * 1000 },
} satisfies Record<string, CachePolicy>;

let substackPersistence: PluginPersistence | null = null;
let substackClient = createThrottledFetch({
  requestsPerMinute: 60,
  maxRetries: 1,
  timeoutMs: 15_000,
  defaultHeaders: DEFAULT_HEADERS,
  dedupeGetRequests: false,
});
const activeFetches = new Map<string, Promise<SubstackCachedData<unknown>>>();

export function attachSubstackPersistence(persistence: PluginPersistence): void {
  substackPersistence = persistence;
}

export function resetSubstackPersistence(): void {
  substackPersistence = null;
  activeFetches.clear();
}

export function setSubstackFetchTransportForTests(transport: ThrottledFetchTransport | null): void {
  substackClient = createThrottledFetch({
    requestsPerMinute: 10_000,
    maxRetries: 0,
    timeoutMs: 15_000,
    defaultHeaders: DEFAULT_HEADERS,
    dedupeGetRequests: false,
    transport: transport ?? undefined,
  });
  activeFetches.clear();
}

function isAuthState(value: unknown): value is SubstackAuthState {
  const record = value as Partial<SubstackAuthState> | null;
  return !!record
    && typeof record === "object"
    && typeof record.email === "string"
    && typeof record.sid === "string"
    && record.sid.length > 0
    && typeof record.loggedInAt === "number";
}

export function getStoredSubstackAuth(): SubstackAuthState | null {
  const auth = substackPersistence?.getState<unknown>(AUTH_STATE_KEY, { schemaVersion: AUTH_SCHEMA_VERSION });
  return isAuthState(auth) ? auth : null;
}

export function storeSubstackAuth(auth: SubstackAuthState): void {
  substackPersistence?.setState(AUTH_STATE_KEY, auth, { schemaVersion: AUTH_SCHEMA_VERSION });
}

export function clearSubstackAuth(): void {
  substackPersistence?.deleteState(AUTH_STATE_KEY);
}

export function requireAuth(): SubstackAuthState {
  const auth = getStoredSubstackAuth();
  if (!auth) throw new SubstackAuthError();
  return auth;
}

function authHeaders(auth: SubstackAuthState): Record<string, string> {
  return {
    cookie: `substack.sid=${auth.sid}; substack.lli=${auth.lli?.trim() || "1"}`,
  };
}

export async function parseErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 240);
  } catch {
    return "";
  }
}

export async function substackFetch(url: string, init?: RequestInit): Promise<Response> {
  return substackClient.fetch(url, init);
}

export async function fetchJsonAuthenticated<T = unknown>(url: string, auth: SubstackAuthState): Promise<T> {
  const response = await substackClient.fetch(url, {
    headers: authHeaders(auth),
  });
  if (response.status === 401 || response.status === 403) {
    clearSubstackAuth();
    throw new SubstackAuthError("Substack session expired");
  }
  if (!response.ok) {
    const detail = await parseErrorText(response);
    throw new Error(`Substack HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export function readResource<T>(kind: string, key: string, allowExpired = false): PersistedResourceValue<T> | null {
  return substackPersistence?.getResource<T>(kind, key, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    allowExpired,
  }) ?? null;
}

function writeResource<T>(kind: string, key: string, value: T, cachePolicy: CachePolicy): PersistedResourceValue<T> | null {
  return substackPersistence?.setResource<T>(kind, key, value, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    cachePolicy,
  }) ?? null;
}

export async function loadCachedResource<T>(
  kind: keyof typeof CACHE_POLICIES,
  key: string,
  force: boolean,
  loader: () => Promise<T>,
): Promise<SubstackCachedData<T>> {
  const fresh = readResource<T>(kind, key, false);
  if (!force && fresh && !fresh.stale) {
    return { data: fresh.value, fetchedAt: fresh.fetchedAt, stale: false };
  }

  const activeKey = `${kind}:${key}`;
  const active = activeFetches.get(activeKey);
  if (active) return active as Promise<SubstackCachedData<T>>;

  const fallback = fresh ?? readResource<T>(kind, key, true);
  const promise = loader()
    .then((data) => {
      const record = writeResource(kind, key, data, CACHE_POLICIES[kind]);
      return {
        data,
        fetchedAt: record?.fetchedAt ?? Date.now(),
        stale: false,
      };
    })
    .catch((error) => {
      if (fallback) {
        return {
          data: fallback.value,
          fetchedAt: fallback.fetchedAt,
          stale: true,
        };
      }
      throw error;
    })
    .finally(() => {
      activeFetches.delete(activeKey);
    });
  activeFetches.set(activeKey, promise as Promise<SubstackCachedData<unknown>>);
  return promise;
}

export function resolveSubstackUrl(value: unknown, baseUrl = SUBSTACK_ORIGIN): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = normalizedHttpUrl(value);
  if (direct) return direct;
  try {
    return normalizedHttpUrl(new URL(value, baseUrl).toString());
  } catch {
    return null;
  }
}
