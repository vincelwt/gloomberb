import type { CompanyProfile, Fundamentals, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { InstrumentSearchResult } from "../types/instrument";
import { debugLog } from "./debug-log";

const DEFAULT_API_URL = "https://api.gloom.sh";
const cloudApiLog = debugLog.createLogger("cloud-api");

export interface ChatMessage {
  id: string;
  channelId: string;
  content: string;
  replyToId: string | null;
  createdAt: string;
  user: { id: string; username: string; displayName: string };
  replyTo?: { content: string; user: { username: string } } | null;
}

export interface ChatChannel {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudQuotePayload extends Quote {
  providerId: "gloomberb-cloud";
  dataSource: "live" | "delayed";
}

export interface CloudCompanyProfile extends CompanyProfile {}

export interface CloudFundamentals extends Fundamentals {}

export interface CloudPricePointPayload {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface CloudTickerFinancialsPayload extends Omit<TickerFinancials, "priceHistory"> {
  quote?: CloudQuotePayload;
  profile?: CloudCompanyProfile;
  fundamentals?: CloudFundamentals;
  priceHistory: CloudPricePointPayload[];
}

export interface CloudVerificationResponse {
  sent: boolean;
  email?: string;
  alreadyVerified?: boolean;
}

export interface QuoteStreamTarget {
  symbol: string;
  exchange?: string;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeExchange(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

function marketKey(symbol: string, exchange?: string): string {
  const normalizedSymbolValue = normalizeSymbol(symbol);
  const normalizedExchangeValue = normalizeExchange(exchange);
  return normalizedExchangeValue ? `${normalizedSymbolValue}:${normalizedExchangeValue}` : normalizedSymbolValue;
}

type ChannelListener = (message: ChatMessage) => void;
type QuoteListener = (target: QuoteStreamTarget, quote: CloudQuotePayload) => void;

class GloomApiClient {
  private sessionToken: string | null = null;
  private websocketToken: string | null = null;
  private currentUser: AuthUser | null = null;
  private readonly baseUrl: string;

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 1000;

  private readonly channelListeners = new Map<string, Set<ChannelListener>>();
  private readonly quoteListeners = new Map<string, Set<QuoteListener>>();
  private readonly quoteTargets = new Map<string, QuoteStreamTarget>();

  constructor() {
    this.baseUrl = process.env.GLOOMBERB_API_URL ?? DEFAULT_API_URL;
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  getWebSocketToken(): string | null {
    return this.websocketToken;
  }

  setSessionToken(token: string | null): void {
    this.sessionToken = token;
    if (!token) {
      this.websocketToken = null;
      this.currentUser = null;
      this.teardownSocket();
    }
  }

  setWebSocketToken(token: string | null): void {
    this.websocketToken = token;
    if (!token) {
      this.teardownSocket();
    }
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  isVerified(): boolean {
    return !!this.sessionToken && !!this.currentUser?.emailVerified;
  }

  private setCurrentUser(user: AuthUser | null): void {
    this.currentUser = user;
    if (!this.shouldKeepSocketOpen()) {
      this.teardownSocket();
      return;
    }
    this.ensureSocket();
  }

  private extractSessionCookie(res: Response): void {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookie) {
      const match = cookie.match(/gloomberb\.session_token=([^;]+)/);
      if (match) {
        this.sessionToken = match[1] ?? null;
      }
    }
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    if (!headers.has("Content-Type") && options?.method && options.method !== "GET") {
      headers.set("Content-Type", "application/json");
    }
    if (this.sessionToken) {
      headers.set("Cookie", `gloomberb.session_token=${this.sessionToken}`);
    }
    headers.set("Origin", this.baseUrl);

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });

    this.extractSessionCookie(res);

    if (!res.ok) {
      const body = await res.text();
      let msg: string;
      try {
        msg = JSON.parse(body).message ?? body;
      } catch {
        msg = body;
      }
      throw new Error(msg);
    }

    const text = await res.text();
    if (!text) return undefined as T;
    const parsed = JSON.parse(text) as T & { token?: string };
    if (typeof parsed?.token === "string" && parsed.token.length > 0) {
      this.websocketToken = parsed.token;
    }
    return parsed as T;
  }

  private getWebSocketBaseUrl(): string {
    const wsProtocol = this.baseUrl.startsWith("https") ? "wss" : "ws";
    return this.baseUrl.replace(/^https?/, wsProtocol);
  }

  private shouldKeepSocketOpen(): boolean {
    return !!this.websocketToken
      && !!this.currentUser?.emailVerified
      && (this.channelListeners.size > 0 || this.quoteTargets.size > 0);
  }

  private ensureSocket(): void {
    if (!this.shouldKeepSocketOpen() || this.ws || this.reconnectTimer) return;

    const url = `${this.getWebSocketBaseUrl()}/cloud/ws?token=${encodeURIComponent(this.websocketToken ?? "")}`;
    cloudApiLog.info("open websocket", {
      hasToken: !!this.websocketToken,
      quoteTargets: this.quoteTargets.size,
      channelTargets: this.channelListeners.size,
    });
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      cloudApiLog.info("websocket open");
      this.reconnectDelayMs = 1000;
      this.flushSubscriptions();
    };

    ws.onmessage = (event) => {
      void this.handleSocketMessage(String(event.data));
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      cloudApiLog.warn("websocket closed", { quoteTargets: this.quoteTargets.size, channelTargets: this.channelListeners.size });
      if (!this.shouldKeepSocketOpen()) return;
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // reconnect is handled by onclose
    };
  }

  private teardownSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      cloudApiLog.info("teardown websocket");
    }
    try {
      ws?.close();
    } catch {
      // ignore closed sockets
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldKeepSocketOpen()) return;
    const delay = this.reconnectDelayMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 10_000);
      this.ensureSocket();
    }, delay);
  }

  private sendSocketMessage(payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (payload && typeof payload === "object" && "type" in (payload as Record<string, unknown>)) {
      const type = (payload as Record<string, unknown>).type;
      if (type === "market.subscribe" || type === "market.unsubscribe" || type === "chat.subscribe") {
        cloudApiLog.info("send websocket message", payload);
      }
    }
    this.ws.send(JSON.stringify(payload));
  }

  private flushSubscriptions(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    for (const channelId of this.channelListeners.keys()) {
      this.sendSocketMessage({ type: "chat.subscribe", channelId });
    }

    if (this.quoteTargets.size > 0) {
      this.sendSocketMessage({
        type: "market.subscribe",
        symbols: [...this.quoteTargets.values()].map((target) => ({
          symbol: target.symbol,
          exchange: target.exchange ?? "",
        })),
      });
    }
  }

  private async handleSocketMessage(raw: string): Promise<void> {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (parsed?.type === "ready" && parsed.user) {
      cloudApiLog.info("websocket ready", { emailVerified: parsed.user.emailVerified === true });
      this.currentUser = {
        ...(this.currentUser ?? {}),
        ...parsed.user,
      };
      return;
    }

    if (parsed?.type === "auth.unverified") {
      cloudApiLog.warn("websocket marked unverified");
      if (this.currentUser) {
        this.currentUser = { ...this.currentUser, emailVerified: false };
      }
      this.teardownSocket();
      return;
    }

    if (parsed?.type === "chat.message" && typeof parsed.channelId === "string" && parsed.data) {
      for (const listener of this.channelListeners.get(parsed.channelId) ?? []) {
        listener(parsed.data as ChatMessage);
      }
      return;
    }

    if (parsed?.type === "market.quote" && parsed.quote && typeof parsed.symbol === "string") {
      const key = marketKey(parsed.symbol, parsed.exchange);
      const target = this.quoteTargets.get(key) ?? {
        symbol: normalizeSymbol(parsed.symbol),
        exchange: normalizeExchange(parsed.exchange),
      };
      for (const listener of this.quoteListeners.get(key) ?? []) {
        listener(target, parsed.quote as CloudQuotePayload);
      }
    }
  }

  async ensureVerifiedSession(): Promise<AuthUser | null> {
    if (!this.sessionToken) return null;
    if (!this.currentUser) {
      await this.getSession();
    }
    return this.currentUser?.emailVerified ? this.currentUser : null;
  }

  async signUp(email: string, username: string, name: string, password: string): Promise<AuthUser> {
    const result = await this.request<{ user: AuthUser }>("/api/auth/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, username, name, password }),
    });
    this.setCurrentUser(result.user);
    return result.user;
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const result = await this.request<{ user: AuthUser }>("/api/auth/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.setCurrentUser(result.user);
    return result.user;
  }

  async signOut(): Promise<void> {
    await this.request("/api/auth/api/auth/sign-out", { method: "POST" });
    this.sessionToken = null;
    this.setCurrentUser(null);
  }

  async getSession(): Promise<AuthUser | null> {
    try {
      const result = await this.request<{ user: AuthUser }>("/api/auth/api/auth/get-session", {
        method: "GET",
      });
      const user = result?.user ?? null;
      this.setCurrentUser(user);
      return user;
    } catch {
      this.setCurrentUser(null);
      return null;
    }
  }

  async sendVerification(): Promise<CloudVerificationResponse> {
    return this.request<CloudVerificationResponse>("/cloud/auth/send-verification", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async getChannels(): Promise<ChatChannel[]> {
    return this.request<ChatChannel[]>("/chat/channels");
  }

  async getMessages(
    channelId: string,
    opts?: { after?: string; before?: string; limit?: number },
  ): Promise<ChatMessage[]> {
    const params = new URLSearchParams();
    if (opts?.after) params.set("after", opts.after);
    if (opts?.before) params.set("before", opts.before);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.request<ChatMessage[]>(`/chat/channels/${channelId}/messages${qs ? `?${qs}` : ""}`);
  }

  async sendMessage(channelId: string, content: string, replyToId?: string): Promise<ChatMessage> {
    return this.request<ChatMessage>(`/chat/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, replyToId }),
    });
  }

  connectChannel(
    channelId: string,
    onMessage: (msg: ChatMessage) => void,
    onError?: (err: string) => void,
  ): { send: (content: string, replyToId?: string) => void; close: () => void } {
    if (!channelId) {
      return { send: () => {}, close: () => {} };
    }

    const listeners = this.channelListeners.get(channelId) ?? new Set<ChannelListener>();
    const firstListener = listeners.size === 0;
    listeners.add(onMessage);
    this.channelListeners.set(channelId, listeners);
    this.ensureSocket();
    if (firstListener) {
      this.sendSocketMessage({ type: "chat.subscribe", channelId });
    }

    return {
      send: (content: string, replyToId?: string) => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.sendSocketMessage({ type: "chat.send", channelId, content, replyToId });
          return;
        }
        void this.sendMessage(channelId, content, replyToId).then(onMessage).catch((error) => {
          onError?.(error instanceof Error ? error.message : String(error));
        });
      },
      close: () => {
        const current = this.channelListeners.get(channelId);
        if (!current) return;
        current.delete(onMessage);
        if (current.size === 0) {
          this.channelListeners.delete(channelId);
        }
        if (!this.shouldKeepSocketOpen()) {
          this.teardownSocket();
        }
      },
    };
  }

  subscribeQuotes(
    targets: QuoteStreamTarget[],
    onQuote: (target: QuoteStreamTarget, quote: CloudQuotePayload) => void,
  ): () => void {
    const uniqueTargets = [...new Map(
      targets
        .filter((target) => typeof target.symbol === "string" && target.symbol.trim().length > 0)
        .map((target) => {
          const normalized = {
            symbol: normalizeSymbol(target.symbol),
            exchange: normalizeExchange(target.exchange),
          } satisfies QuoteStreamTarget;
          return [marketKey(normalized.symbol, normalized.exchange), normalized] as const;
        }),
    ).values()];

    const newSubscriptions: QuoteStreamTarget[] = [];
    for (const target of uniqueTargets) {
      const key = marketKey(target.symbol, target.exchange);
      const listeners = this.quoteListeners.get(key) ?? new Set<QuoteListener>();
      if (listeners.size === 0) {
        newSubscriptions.push(target);
      }
      listeners.add(onQuote);
      this.quoteListeners.set(key, listeners);
      this.quoteTargets.set(key, target);
    }

    this.ensureSocket();
    if (newSubscriptions.length > 0) {
      cloudApiLog.info("register quote listeners", {
        count: newSubscriptions.length,
        symbols: newSubscriptions.map((target) => marketKey(target.symbol, target.exchange)),
      });
      this.sendSocketMessage({
        type: "market.subscribe",
        symbols: newSubscriptions.map((target) => ({
          symbol: target.symbol,
          exchange: target.exchange ?? "",
        })),
      });
    }

    return () => {
      const removedTargets: QuoteStreamTarget[] = [];

      for (const target of uniqueTargets) {
        const key = marketKey(target.symbol, target.exchange);
        const listeners = this.quoteListeners.get(key);
        if (!listeners) continue;
        listeners.delete(onQuote);
        if (listeners.size === 0) {
          this.quoteListeners.delete(key);
          const storedTarget = this.quoteTargets.get(key);
          if (storedTarget) {
            removedTargets.push(storedTarget);
          }
          this.quoteTargets.delete(key);
        }
      }

      if (removedTargets.length > 0) {
        cloudApiLog.info("remove quote listeners", {
          count: removedTargets.length,
          symbols: removedTargets.map((target) => marketKey(target.symbol, target.exchange)),
        });
        this.sendSocketMessage({
          type: "market.unsubscribe",
          symbols: removedTargets.map((target) => ({
            symbol: target.symbol,
            exchange: target.exchange ?? "",
          })),
        });
      }

      if (!this.shouldKeepSocketOpen()) {
        this.teardownSocket();
      }
    };
  }

  async searchInstruments(query: string, limit = 10): Promise<InstrumentSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });
    return this.request<InstrumentSearchResult[]>(`/market/search?${params.toString()}`);
  }

  async getCloudQuote(symbol: string, exchange?: string): Promise<CloudQuotePayload> {
    const params = new URLSearchParams({ symbol });
    if (exchange) params.set("exchange", exchange);
    return this.request<CloudQuotePayload>(`/market/quote?${params.toString()}`);
  }

  async getCloudFinancials(symbol: string, exchange?: string): Promise<CloudTickerFinancialsPayload> {
    const params = new URLSearchParams({ symbol });
    if (exchange) params.set("exchange", exchange);
    return this.request<CloudTickerFinancialsPayload>(`/market/financials?${params.toString()}`);
  }

  async getCloudHistory(
    symbol: string,
    exchange: string,
    params: {
      interval?: string;
      outputsize?: number;
      startDate?: string;
      endDate?: string;
      rangeKey?: string;
    } = {},
  ): Promise<CloudPricePointPayload[]> {
    const search = new URLSearchParams({ symbol, exchange });
    if (params.interval) search.set("interval", params.interval);
    if (params.outputsize != null) search.set("outputsize", String(params.outputsize));
    if (params.startDate) search.set("startDate", params.startDate);
    if (params.endDate) search.set("endDate", params.endDate);
    if (params.rangeKey) search.set("rangeKey", params.rangeKey);
    return this.request<CloudPricePointPayload[]>(`/market/history?${search.toString()}`);
  }

  async getCloudExchangeRate(fromCurrency: string): Promise<number> {
    const params = new URLSearchParams({ fromCurrency });
    const result = await this.request<{ rate: number }>(`/market/exchange-rate?${params.toString()}`);
    return result.rate;
  }
}

export const apiClient = new GloomApiClient();
export type { PricePoint };
