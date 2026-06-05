import type { SubstackAuthState } from "./types";
import {
  parseErrorText,
  resolveSubstackUrl,
  storeSubstackAuth,
  substackFetch,
  SUBSTACK_ORIGIN,
} from "./store";

export async function requestSubstackMagicLink(email: string): Promise<void> {
  const normalizedEmail = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email address");
  }
  const response = await substackFetch(`${SUBSTACK_ORIGIN}/api/v1/email-login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: normalizedEmail }),
  });
  if (!response.ok) {
    const detail = await parseErrorText(response);
    throw new Error(`Substack login link failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
}

export function splitSetCookieHeader(header: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inExpires = false;
  for (let i = 0; i < header.length; i += 1) {
    const char = header[i];
    if (char === ",") {
      const fragment = header.slice(start, i);
      inExpires = /expires=/i.test(fragment) && !/;\s*(?:max-age|domain|path|secure|httponly|samesite)\b/i.test(fragment);
      if (!inExpires) {
        parts.push(fragment.trim());
        start = i + 1;
      }
    } else if (char === ";") {
      inExpires = false;
    }
  }
  const tail = header.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const direct = withGetSetCookie.getSetCookie?.();
  if (direct && direct.length > 0) return direct;
  const header = headers.get("set-cookie");
  return header ? splitSetCookieHeader(header) : [];
}

export function parseCookiesFromSetCookie(headers: string[]): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const header of headers) {
    const first = header.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    cookies.set(name, value);
  }
  return cookies;
}

function cookieHeaderFromJar(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function mergeSetCookies(cookieJar: Map<string, string>, response: Response): void {
  for (const [name, value] of parseCookiesFromSetCookie(getSetCookieHeaders(response.headers))) {
    cookieJar.set(name, value);
  }
}

async function followRedirectsForCookies(startUrl: string, cookieJar: Map<string, string>): Promise<void> {
  let currentUrl = startUrl;
  for (let redirectCount = 0; redirectCount < 8; redirectCount += 1) {
    const response = await substackFetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: cookieJar.size > 0 ? { cookie: cookieHeaderFromJar(cookieJar) } : undefined,
    });
    mergeSetCookies(cookieJar, response);

    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) break;
    const nextUrl = resolveSubstackUrl(location, currentUrl);
    if (!nextUrl) break;
    currentUrl = nextUrl;
  }
}

export async function completeSubstackMagicLink(link: string, email: string): Promise<SubstackAuthState> {
  const currentUrl = resolveSubstackUrl(link);
  if (!currentUrl) throw new Error("Paste the full Substack magic-link URL");

  const cookieJar = new Map<string, string>();
  await followRedirectsForCookies(currentUrl, cookieJar);

  const sid = cookieJar.get("substack.sid");
  if (!sid) {
    throw new Error("Substack did not return a session cookie. Request a new login link and paste the full URL.");
  }
  const auth: SubstackAuthState = {
    email: email.trim(),
    sid,
    lli: cookieJar.get("substack.lli") ?? "1",
    loggedInAt: Date.now(),
  };
  storeSubstackAuth(auth);
  return auth;
}

export async function completeSubstackOtpLogin(code: string, email: string): Promise<SubstackAuthState> {
  const normalizedCode = code.trim();
  const normalizedEmail = email.trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error("Enter the 6-digit Substack email code");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email address");
  }

  const cookieJar = new Map<string, string>();
  const response = await substackFetch(`${SUBSTACK_ORIGIN}/api/v1/email-otp-login/complete`, {
    method: "POST",
    redirect: "manual",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      code: normalizedCode,
      email: normalizedEmail,
      redirect: "",
      for_pub: null,
      island_magic_signin: false,
    }),
  });
  mergeSetCookies(cookieJar, response);

  const isRedirect = response.status >= 300 && response.status < 400;
  if (!response.ok && !isRedirect) {
    const detail = await parseErrorText(response);
    throw new Error(`Substack code login failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  let redirectUrl = resolveSubstackUrl(response.headers.get("location"));
  if (!redirectUrl && response.ok) {
    try {
      const payload = await response.clone().json() as { redirect?: unknown };
      redirectUrl = resolveSubstackUrl(payload.redirect);
    } catch {
      redirectUrl = null;
    }
  }

  if (!cookieJar.get("substack.sid") && redirectUrl) {
    await followRedirectsForCookies(redirectUrl, cookieJar);
  }

  const sid = cookieJar.get("substack.sid");
  if (!sid) {
    const capturedCookieNames = [...cookieJar.keys()];
    throw new Error(
      `Substack accepted the code but did not return a session cookie. status=${response.status} redirect=${redirectUrl ? "yes" : "no"} cookies=${capturedCookieNames.length ? capturedCookieNames.join(",") : "none"}`,
    );
  }
  const auth: SubstackAuthState = {
    email: normalizedEmail,
    sid,
    lli: cookieJar.get("substack.lli") ?? "1",
    loggedInAt: Date.now(),
  };
  storeSubstackAuth(auth);
  return auth;
}
