import { httpFetch } from "../../../utils/http-transport";
import type { FlexQueryConfig } from "../config";
import { IBKR_STATEMENT_URL } from "../config";

const IBKR_STATEMENT_GET_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";
const FLEX_STATEMENT_CACHE_MS = 15 * 60_000;
const FLEX_STATEMENT_INITIAL_WAIT_MS = 3_000;
const FLEX_STATEMENT_POLL_DELAY_MS = 5_000;
const FLEX_STATEMENT_MAX_DOWNLOAD_ATTEMPTS = 60;
const flexStatementCache = new Map<string, { createdAt: number; promise: Promise<string> }>();

type FlexRequestPhase = "request" | "download";

interface FlexErrorContext {
  phase: FlexRequestPhase;
  endpoint?: string;
  queryId?: string;
  token?: string;
  referenceCode?: string;
  httpStatus?: number;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function extractFlexErrorMessage(text: string): string | null {
  const errorMatch = text.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/);
  if (errorMatch?.[1]) return decodeXmlText(errorMatch[1].trim());
  return null;
}

function endpointName(endpoint: string | undefined): string {
  if (!endpoint) return "default";
  try {
    const url = new URL(endpoint);
    return url.pathname.split("/").filter(Boolean).at(-1) || url.hostname;
  } catch {
    return endpoint.split("?")[0]?.split("/").filter(Boolean).at(-1) || endpoint;
  }
}

function buildFlexErrorMessage(providerMessage: string, context: FlexErrorContext): string {
  const phase = context.phase === "request"
    ? "requesting the statement"
    : "downloading the generated statement";
  const details = [
    `Endpoint ${endpointName(context.endpoint)}`,
    context.queryId ? `query ID ${context.queryId}` : null,
    context.referenceCode ? `reference code ${context.referenceCode}` : null,
    context.token ? "token configured" : "token missing",
    context.httpStatus && context.httpStatus >= 400 ? `HTTP ${context.httpStatus}` : null,
  ].filter(Boolean).join(", ");
  const advice = context.phase === "request"
    ? "Check that Flex Web Service is enabled, the token is active, and the query ID belongs to that token."
    : "IBKR accepted the request but did not return the statement; retry shortly or check that the Flex query can generate a statement.";

  return `IBKR Flex request failed while ${phase}: ${providerMessage}. ${details}. ${advice}`;
}

function flexError(providerMessage: string, context: FlexErrorContext): Error {
  return new Error(buildFlexErrorMessage(providerMessage, context));
}

export async function requestFlexStatement(config: FlexQueryConfig): Promise<string> {
  const endpoint = config.endpoint || IBKR_STATEMENT_URL;
  const url = `${endpoint}?t=${config.token}&q=${config.queryId}&v=3`;
  let resp: Response;
  let text: string;
  try {
    resp = await httpFetch(url, { signal: AbortSignal.timeout(30_000) });
    text = await resp.text();
  } catch (error) {
    throw flexError(error instanceof Error ? error.message : "Network request failed", {
      phase: "request",
      endpoint,
      queryId: config.queryId,
      token: config.token,
    });
  }

  const codeMatch = text.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/);
  if (!codeMatch) {
    throw flexError(extractFlexErrorMessage(text) || "No reference code returned", {
      phase: "request",
      endpoint,
      queryId: config.queryId,
      token: config.token,
      httpStatus: resp.status,
    });
  }

  return codeMatch[1]!;
}

async function getFlexStatement(
  token: string,
  referenceCode: string,
  context: Partial<Pick<FlexQueryConfig, "endpoint" | "queryId">> = {},
): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, FLEX_STATEMENT_INITIAL_WAIT_MS));

  const url = `${IBKR_STATEMENT_GET_URL}?t=${token}&q=${referenceCode}&v=3`;
  for (let attempt = 0; attempt < FLEX_STATEMENT_MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    let resp: Response;
    let text: string;
    try {
      resp = await httpFetch(url, { signal: AbortSignal.timeout(30_000) });
      text = await resp.text();
    } catch (error) {
      throw flexError(error instanceof Error ? error.message : "Network request failed", {
        phase: "download",
        endpoint: context.endpoint,
        queryId: context.queryId,
        token,
        referenceCode,
      });
    }

    if (text.includes("<FlexQueryResponse") || text.includes("<FlexStatements")) {
      return text;
    }

    if (text.includes("Statement generation in progress")) {
      await new Promise((resolve) => setTimeout(resolve, FLEX_STATEMENT_POLL_DELAY_MS));
      continue;
    }

    const providerMessage = extractFlexErrorMessage(text);
    if (providerMessage) {
      throw flexError(providerMessage, {
        phase: "download",
        endpoint: context.endpoint,
        queryId: context.queryId,
        token,
        referenceCode,
        httpStatus: resp.status,
      });
    }
  }

  throw flexError("statement generation timed out", {
    phase: "download",
    endpoint: context.endpoint,
    queryId: context.queryId,
    token,
    referenceCode,
  });
}

export async function loadFlexStatement(config: FlexQueryConfig): Promise<string> {
  const cacheKey = `${config.endpoint || IBKR_STATEMENT_URL}|${config.token}|${config.queryId}`;
  const existing = flexStatementCache.get(cacheKey);
  if (existing && Date.now() - existing.createdAt < FLEX_STATEMENT_CACHE_MS) {
    return existing.promise;
  }

  const promise = (async () => {
    const referenceCode = await requestFlexStatement(config);
    return getFlexStatement(config.token, referenceCode, config);
  })();
  flexStatementCache.set(cacheKey, { createdAt: Date.now(), promise });
  promise.catch(() => {
    const cached = flexStatementCache.get(cacheKey);
    if (cached?.promise === promise) {
      flexStatementCache.delete(cacheKey);
    }
  });
  setTimeout(() => {
    const cached = flexStatementCache.get(cacheKey);
    if (cached?.promise === promise) {
      flexStatementCache.delete(cacheKey);
    }
  }, FLEX_STATEMENT_CACHE_MS);
  return promise;
}
