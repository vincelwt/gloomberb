import { httpFetch } from "../utils/http-transport";
import { ApiRequestError, parseApiErrorMessage } from "./errors";

const DEFAULT_API_URL = "https://api.gloom.sh";
const SESSION_COOKIE_NAMES = ["__Secure-gloomberb.session_token", "gloomberb.session_token"] as const;

type CloudApiResponse = Pick<Response, "ok" | "status" | "headers" | "text">;
type CloudApiFetchTransport = (url: string, init?: RequestInit) => Promise<CloudApiResponse>;
type SessionCookieName = (typeof SESSION_COOKIE_NAMES)[number];

let cloudApiFetchTransport: CloudApiFetchTransport = httpFetch;

export function setCloudApiFetchTransport(transport: CloudApiFetchTransport | null): void {
  cloudApiFetchTransport = transport ?? httpFetch;
}

function getCloudApiBaseUrl(): string {
  if (typeof process === "undefined") {
    return DEFAULT_API_URL;
  }
  return process.env.GLOOMBERB_API_URL ?? DEFAULT_API_URL;
}

export class CloudApiRequestTransport {
  private sessionToken: string | null = null;
  private sessionCookieName: SessionCookieName | null = null;
  private websocketToken: string | null = null;

  readonly baseUrl = getCloudApiBaseUrl();

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  getWebSocketToken(): string | null {
    return this.websocketToken;
  }

  setSessionToken(token: string | null): void {
    if (this.sessionToken !== token) {
      this.sessionCookieName = null;
    }
    this.sessionToken = token;
    if (!token) {
      this.websocketToken = null;
    }
  }

  setWebSocketToken(token: string | null): void {
    this.websocketToken = token;
  }

  getSocketAuthToken(): string | null {
    return this.websocketToken || this.sessionToken;
  }

  clearWebSocketTokenForFallback(): boolean {
    if (!this.websocketToken || !this.sessionToken) return false;
    this.websocketToken = null;
    return true;
  }

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    if (!headers.has("Content-Type") && options?.method && options.method !== "GET") {
      headers.set("Content-Type", "application/json");
    }
    this.setSessionCookieHeader(headers);
    headers.set("Origin", this.baseUrl);

    const res = await cloudApiFetchTransport(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });

    this.extractSessionCookie(res);

    if (!res.ok) {
      const body = await res.text();
      const msg = parseApiErrorMessage(body);
      throw new ApiRequestError(msg, res.status);
    }

    const text = await res.text();
    if (!text) return undefined as T;
    const parsed = JSON.parse(text) as T & { token?: string };
    if (typeof parsed?.token === "string" && parsed.token.length > 0) {
      this.websocketToken = parsed.token;
    }
    return parsed as T;
  }

  private extractSessionCookie(res: CloudApiResponse): void {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const fallbackHeader = res.headers.get("set-cookie");
    if (fallbackHeader) {
      setCookie.push(fallbackHeader);
    }
    for (const cookie of setCookie) {
      for (const cookieName of SESSION_COOKIE_NAMES) {
        const escapedCookieName = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = cookie.match(new RegExp(`${escapedCookieName}=([^;]+)`));
        if (!match) continue;
        this.sessionToken = match[1] ?? null;
        this.sessionCookieName = cookieName;
        return;
      }
    }
  }

  private buildSessionCookieHeader(): string | null {
    if (!this.sessionToken) return null;
    const cookieNames = this.sessionCookieName ? [this.sessionCookieName] : SESSION_COOKIE_NAMES;
    return cookieNames.map((cookieName) => `${cookieName}=${this.sessionToken}`).join("; ");
  }

  private setSessionCookieHeader(headers: Headers): void {
    const cookieHeader = this.buildSessionCookieHeader();
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }
  }
}
