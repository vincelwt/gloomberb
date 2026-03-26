const DEFAULT_API_URL = "https://api.gloomberb.com";

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

class GloomApiClient {
  private sessionToken: string | null = null;
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.GLOOMBERB_API_URL ?? DEFAULT_API_URL;
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  setSessionToken(token: string | null): void {
    this.sessionToken = token;
  }

  private extractSessionCookie(res: Response): void {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookie) {
      const match = cookie.match(/gloomberb\.session_token=([^;]+)/);
      if (match) {
        this.sessionToken = match[1];
      }
    }
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    if (!headers.has("Content-Type") && options?.method !== "GET") {
      headers.set("Content-Type", "application/json");
    }
    if (this.sessionToken) {
      headers.set("Cookie", `gloomberb.session_token=${this.sessionToken}`);
    }

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
    return JSON.parse(text) as T;
  }

  // --- Auth ---

  async signUp(email: string, username: string, name: string, password: string): Promise<AuthUser> {
    const result = await this.request<{ user: AuthUser }>("/api/auth/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, username, name, password }),
    });
    return result.user;
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const result = await this.request<{ user: AuthUser }>("/api/auth/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return result.user;
  }

  async signOut(): Promise<void> {
    await this.request("/api/auth/api/auth/sign-out", { method: "POST" });
    this.sessionToken = null;
  }

  async getSession(): Promise<AuthUser | null> {
    try {
      const result = await this.request<{ user: AuthUser }>("/api/auth/api/auth/get-session", {
        method: "GET",
      });
      return result?.user ?? null;
    } catch {
      return null;
    }
  }

  // --- Chat ---

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
}

export const apiClient = new GloomApiClient();
