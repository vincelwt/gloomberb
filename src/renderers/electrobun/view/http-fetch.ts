/// <reference lib="dom" />
import { setPredictionMarketsFetchTransport } from "../../../plugins/prediction-markets/services/fetch";
import { setCloudApiFetchTransport } from "../../../utils/api-client";
import { backendRequest } from "./backend-rpc";

interface ElectrobunHttpFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  setCookie?: string[];
  body: string;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!headers) return normalized;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      normalized[key] = value;
    }
    return normalized;
  }
  return { ...headers };
}

function createAbortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

async function serializeBody(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  return new Response(body).text();
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    throw createAbortError();
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function electrobunHttpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (init?.signal?.aborted) {
    throw createAbortError();
  }

  const requestPromise = requestBackendHttpFetch(url, init);

  const response = await withAbort(requestPromise, init?.signal);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function requestBackendHttpFetch(url: string, init?: RequestInit): Promise<ElectrobunHttpFetchResponse> {
  return backendRequest<ElectrobunHttpFetchResponse>("http.fetch", {
    url,
    init: {
      method: init?.method,
      headers: normalizeHeaders(init?.headers),
      body: await serializeBody(init?.body),
    },
  });
}

function createResponseHeaders(headers: Record<string, string>, setCookie: string[] = []): Headers {
  const responseHeaders = new Headers(headers);
  if (setCookie.length === 0) return responseHeaders;

  const originalGet = responseHeaders.get.bind(responseHeaders);
  responseHeaders.get = ((name: string) => (
    name.toLowerCase() === "set-cookie" ? setCookie[0] ?? null : originalGet(name)
  )) as Headers["get"];
  (responseHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie = () => [...setCookie];
  return responseHeaders;
}

async function electrobunCloudApiFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await requestBackendHttpFetch(url, init);

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText,
    headers: createResponseHeaders(response.headers, response.setCookie),
    text: async () => response.body,
  } as Response;
}

export function installElectrobunPredictionMarketsFetchTransport(): void {
  setPredictionMarketsFetchTransport(electrobunHttpFetch);
}

export function installElectrobunCloudApiFetchTransport(): void {
  setCloudApiFetchTransport(electrobunCloudApiFetch);
}
