export type HttpFetchTransport = (url: string, init?: RequestInit) => Promise<Response>;

let httpFetchTransport: HttpFetchTransport | null = null;

export function setHttpFetchTransport(transport: HttpFetchTransport | null): void {
  httpFetchTransport = transport;
}

export function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  return (httpFetchTransport ?? globalThis.fetch)(url, init);
}
