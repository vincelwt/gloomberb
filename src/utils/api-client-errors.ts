const HARD_SESSION_INVALID_PATTERNS = [
  /\b(user|account)\b.*\b(not found|deleted|removed|disabled|deactivated|suspended)\b/i,
  /\b(user|account)\b.*\bdoes(?:\s+not|n't)\s+exist\b/i,
  /\b(no|unknown|missing)\s+(user|account)\b/i,
];

export class ApiRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function parseApiErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const parts = [parsed.message, parsed.error, parsed.code, parsed.reason]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return parts.join(" ") || body;
  } catch {
    return body;
  }
}

export function isHardSessionInvalidMessage(message: string): boolean {
  const normalized = message.replace(/[_-]+/g, " ");
  return HARD_SESSION_INVALID_PATTERNS.some((pattern) => pattern.test(normalized));
}
