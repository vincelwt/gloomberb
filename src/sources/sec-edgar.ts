import type { SecFilingDocument, SecFilingItem } from "../types/data-provider";
import { truncateWithEllipsis } from "../utils/text-wrap";
import {
  PDF_FALLBACK_MESSAGE,
  extractFilingContent,
  isPdfDocument,
} from "./sec-edgar/content";

export { extractFilingContent } from "./sec-edgar/content";

const LOOKUP_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions";
const FETCH_TIMEOUT_MS = 15_000;

function sanitizeIdentityPart(value: string, fallback: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function extractEmail(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ?? null;
}

function getEnv(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

function getRuntimeHostName(): string {
  const maybeLocation = (globalThis as { location?: { hostname?: string } }).location;
  if (maybeLocation?.hostname) {
    return maybeLocation.hostname;
  }
  return "localhost";
}

const runtimeHostName = getRuntimeHostName();

const DEFAULT_SEC_FROM =
  getEnv("SEC_FROM_EMAIL")?.trim()
  || extractEmail(getEnv("SEC_USER_AGENT"))
  || `${sanitizeIdentityPart(getEnv("USER") ?? "gloomberb", "gloomberb")}@${sanitizeIdentityPart(`${runtimeHostName}.local`, "localhost.localdomain")}`;

const DEFAULT_SEC_USER_AGENT =
  getEnv("SEC_USER_AGENT")?.trim()
  || `Gloomberb/0.1 (${sanitizeIdentityPart(runtimeHostName, "localhost")}; contact=${DEFAULT_SEC_FROM})`;

type LookupEntry = {
  cik: string;
  exchange?: string;
  name?: string;
};

function normalize(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

function zeroPadCik(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(10, "0");
}

function parseTimestamp(value: unknown): Date | undefined {
  const digits = String(value ?? "").trim();
  if (!/^\d{14}$/.test(digits)) return undefined;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const hour = Number(digits.slice(8, 10));
  const minute = Number(digits.slice(10, 12));
  const second = Number(digits.slice(12, 14));
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function parseDate(value: unknown): Date | undefined {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return new Date(`${text}T00:00:00Z`);
}

function stripAccessionDashes(accessionNumber: string): string {
  return accessionNumber.replace(/-/g, "");
}

function documentNameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return url.split("/").pop() ?? url;
  }
}

function normalizeDocumentName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function decodeSecHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

function cleanSecTableText(value: string): string {
  return decodeSecHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function resolveSecArchiveUrl(href: string, filingUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, filingUrl);
    const ixviewerDocument = url.searchParams.get("doc");
    if (ixviewerDocument?.startsWith("/Archives/")) {
      return new URL(ixviewerDocument, "https://www.sec.gov").toString();
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isHtmlResponse(body: string): boolean {
  return /^\s*<!DOCTYPE html/i.test(body) || /^\s*<html/i.test(body);
}

function isSecBlockMessage(body: string): boolean {
  return /Undeclared Automated Tool|Request Rate Threshold Exceeded/i.test(body);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseTickerLookup(payload: unknown): Map<string, LookupEntry> {
  const results = new Map<string, LookupEntry>();
  const record = asRecord(payload);
  if (!record) return results;

  const fields = Array.isArray(record.fields)
    ? record.fields.map((field) => String(field))
    : null;
  const data = Array.isArray(record.data) ? record.data : null;

  if (fields && data) {
    const cikIndex = fields.findIndex((field) => normalize(field) === "CIK");
    const tickerIndex = fields.findIndex((field) => normalize(field) === "TICKER");
    const exchangeIndex = fields.findIndex((field) => normalize(field) === "EXCHANGE");
    const nameIndex = fields.findIndex((field) => normalize(field) === "NAME");

    for (const row of data) {
      if (!Array.isArray(row)) continue;
      const ticker = normalize(String(row[tickerIndex] ?? ""));
      const cik = zeroPadCik(row[cikIndex]);
      if (!ticker || !cik) continue;
      results.set(ticker, {
        cik,
        exchange: typeof row[exchangeIndex] === "string" ? row[exchangeIndex] as string : undefined,
        name: typeof row[nameIndex] === "string" ? row[nameIndex] as string : undefined,
      });
    }
    if (results.size > 0) return results;
  }

  for (const value of Object.values(record)) {
    const entry = asRecord(value);
    if (!entry) continue;
    const ticker = normalize(String(entry.ticker ?? entry.symbol ?? ""));
    const cik = zeroPadCik(entry.cik ?? entry.cik_str);
    if (!ticker || !cik) continue;
    results.set(ticker, {
      cik,
      exchange: typeof entry.exchange === "string" ? entry.exchange : undefined,
      name: typeof entry.title === "string"
        ? entry.title
        : typeof entry.name === "string"
          ? entry.name
          : undefined,
    });
  }

  return results;
}

export function parseRecentFilings(payload: unknown, count = 15): SecFilingItem[] {
  const record = asRecord(payload);
  const filings = asRecord(record?.filings);
  const recent = asRecord(filings?.recent);
  if (!record || !recent) return [];

  const accessionNumbers = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const filingDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const acceptanceTimes = Array.isArray(recent.acceptanceDateTime) ? recent.acceptanceDateTime : [];
  const primaryDocuments = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
  const primaryDescriptions = Array.isArray(recent.primaryDocDescription) ? recent.primaryDocDescription : [];
  const items = Array.isArray(recent.items) ? recent.items : [];
  const cik = zeroPadCik(record.cik) ?? "";
  const displayCik = String(Number(cik || "0"));
  const companyName = typeof record.name === "string" ? record.name : undefined;
  const total = Math.min(
    Math.max(accessionNumbers.length, forms.length, filingDates.length),
    Math.max(count, 0),
  );

  const results: SecFilingItem[] = [];
  for (let index = 0; index < total; index += 1) {
    const accessionNumber = String(accessionNumbers[index] ?? "").trim();
    const form = String(forms[index] ?? "").trim();
    const filingDate = parseDate(filingDates[index]);
    if (!accessionNumber || !form || !filingDate || !displayCik) continue;

    const accessionNumberNoDashes = stripAccessionDashes(accessionNumber);
    const primaryDocument = String(primaryDocuments[index] ?? "").trim() || undefined;
    const filingUrl = `https://www.sec.gov/Archives/edgar/data/${displayCik}/${accessionNumber}-index.htm`;
    const primaryDocumentUrl = primaryDocument
      ? `https://www.sec.gov/Archives/edgar/data/${displayCik}/${accessionNumberNoDashes}/${primaryDocument}`
      : undefined;

    results.push({
      accessionNumber,
      form,
      filingDate,
      acceptedAt: parseTimestamp(acceptanceTimes[index]),
      primaryDocument,
      primaryDocDescription: String(primaryDescriptions[index] ?? "").trim() || undefined,
      items: String(items[index] ?? "").trim() || undefined,
      cik,
      companyName,
      filingUrl,
      primaryDocumentUrl,
    });
  }

  return results;
}

export function parseFilingDocuments(indexHtml: string, filing: SecFilingItem): SecFilingDocument[] {
  const documents: SecFilingDocument[] = [];
  const primaryUrl = normalizeDocumentName(filing.primaryDocumentUrl);
  const primaryDocument = normalizeDocumentName(filing.primaryDocument);
  const rows = [...indexHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1] ?? "";
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] ?? "");
    if (cells.length < 3) continue;

    const hrefMatch = rowHtml.match(/<a\b[^>]*href="([^"]+)"[^>]*>/i);
    if (!hrefMatch?.[1]) continue;
    const url = resolveSecArchiveUrl(hrefMatch[1], filing.filingUrl);
    if (!url || !url.includes("/Archives/edgar/data/")) continue;

    const sequence = cleanSecTableText(cells[0] ?? "") || undefined;
    const description = cleanSecTableText(cells[1] ?? "") || undefined;
    const linkedDocument = cleanSecTableText(cells[2] ?? "") || documentNameFromUrl(url);
    const type = cleanSecTableText(cells[3] ?? "") || linkedDocument;
    const size = cleanSecTableText(cells[4] ?? "") || undefined;
    const document = linkedDocument || documentNameFromUrl(url);
    const normalizedDocument = normalizeDocumentName(document);
    const normalizedUrl = normalizeDocumentName(url);

    documents.push({
      sequence,
      type,
      description,
      document,
      url,
      size,
      isPrimary: (
        (primaryDocument.length > 0 && normalizedDocument === primaryDocument)
        || (primaryUrl.length > 0 && normalizedUrl === primaryUrl)
        || (
          documents.length === 0
          && normalizeDocumentName(type) === normalizeDocumentName(filing.form)
        )
      ),
    });
  }

  return documents;
}

export class SecEdgarClient {
  private lookupPromise: Promise<Map<string, LookupEntry>> | null = null;

  private defaultHeaders() {
    return {
      "User-Agent": DEFAULT_SEC_USER_AGENT,
      From: DEFAULT_SEC_FROM,
      Accept: "application/json,text/plain,*/*",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.sec.gov/",
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: this.defaultHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await response.text();

    if (!response.ok) {
      if (isSecBlockMessage(body)) {
        throw new Error("SEC blocked the request. Try setting SEC_USER_AGENT to 'MyApp AdminContact@example.com'.");
      }
      throw new Error(`SEC request failed (${response.status}): ${truncateWithEllipsis(body.trim(), 160)}`);
    }

    if (isHtmlResponse(body)) {
      if (isSecBlockMessage(body)) {
        throw new Error("SEC blocked the request. Try setting SEC_USER_AGENT to 'MyApp AdminContact@example.com'.");
      }
      throw new Error("SEC returned HTML instead of JSON.");
    }

    return JSON.parse(body) as T;
  }

  private async fetchText(url: string): Promise<{ body: string; contentType: string }> {
    const response = await fetch(url, {
      headers: this.defaultHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await response.text();

    if (!response.ok) {
      if (isSecBlockMessage(body)) {
        throw new Error("SEC blocked the request. Try setting SEC_USER_AGENT to 'MyApp AdminContact@example.com'.");
      }
      throw new Error(`SEC request failed (${response.status}): ${truncateWithEllipsis(body.trim(), 160)}`);
    }

    if (isSecBlockMessage(body)) {
      throw new Error("SEC blocked the request. Try setting SEC_USER_AGENT to 'MyApp AdminContact@example.com'.");
    }

    return {
      body,
      contentType: response.headers.get("content-type") ?? "",
    };
  }

  private extractArchiveLinks(indexHtml: string): string[] {
    const matches = [...indexHtml.matchAll(/<a[^>]+href="([^"]+)"[^>]*>/gi)];
    const urls = matches
      .map((match) => match[1] ?? "")
      .map((href) => {
        if (/^https?:\/\//i.test(href)) return href;
        if (href.startsWith("/Archives/")) return `https://www.sec.gov${href}`;
        return null;
      })
      .filter((value): value is string => !!value && value.includes("/Archives/edgar/data/"));

    return [...new Set(urls)];
  }

  private async findAlternativeHtmlDocumentUrl(filingUrl: string, currentUrl?: string): Promise<string | null> {
    const { body } = await this.fetchText(filingUrl);
    const links = this.extractArchiveLinks(body);
    return links.find((url) => (
      url !== currentUrl
      && !/-index\.htm(?:$|[?#])/i.test(url)
      && /\.(?:html?|xhtml)(?:$|[?#])/i.test(url)
    )) ?? null;
  }

  private async loadLookup(): Promise<Map<string, LookupEntry>> {
    if (!this.lookupPromise) {
      this.lookupPromise = this.fetchJson<unknown>(LOOKUP_URL)
        .then((payload) => parseTickerLookup(payload))
        .catch((error) => {
          this.lookupPromise = null;
          throw error;
        });
    }
    return this.lookupPromise;
  }

  async getRecentFilings(ticker: string, count = 15): Promise<SecFilingItem[]> {
    const normalizedTicker = normalize(ticker);
    if (!normalizedTicker) return [];

    const lookup = await this.loadLookup();
    const entry = lookup.get(normalizedTicker);
    if (!entry) return [];

    const payload = await this.fetchJson<unknown>(`${SUBMISSIONS_URL}/CIK${entry.cik}.json`);
    return parseRecentFilings(payload, count);
  }

  async getFilingDocuments(filing: SecFilingItem): Promise<SecFilingDocument[]> {
    const { body } = await this.fetchText(filing.filingUrl);
    return parseFilingDocuments(body, filing);
  }

  async getFilingContent(filing: Pick<SecFilingItem, "primaryDocumentUrl" | "filingUrl" | "form">): Promise<string | null> {
    let targetUrl = filing.primaryDocumentUrl || filing.filingUrl;
    if (!targetUrl) return null;

    // SEC ownership forms (3/4/5) have XSL-prefixed primaryDocument paths
    // (e.g., "xslF345X06/wk-form4_xxx.xml") which return rendered HTML.
    // Strip the prefix and return the raw XML for programmatic parsing.
    const ownershipForms = new Set(["3", "4", "5"]);
    if (filing.primaryDocumentUrl && filing.form && ownershipForms.has(filing.form.trim())) {
      const rawUrl = filing.primaryDocumentUrl.replace(/\/xsl[^/]+\//, "/");
      if (rawUrl !== filing.primaryDocumentUrl) {
        const { body } = await this.fetchText(rawUrl);
        return body;
      }
    }

    if (filing.primaryDocumentUrl && isPdfDocument("", "", filing.primaryDocumentUrl)) {
      if (filing.filingUrl === filing.primaryDocumentUrl) {
        return PDF_FALLBACK_MESSAGE;
      }
      const alternativeUrl = filing.filingUrl
        ? await this.findAlternativeHtmlDocumentUrl(filing.filingUrl, filing.primaryDocumentUrl)
        : null;
      if (!alternativeUrl) return PDF_FALLBACK_MESSAGE;

      const { body, contentType } = await this.fetchText(alternativeUrl);
      return extractFilingContent(body, contentType, { form: filing.form, sourceUrl: alternativeUrl });
    }

    const { body, contentType } = await this.fetchText(targetUrl);
    return extractFilingContent(body, contentType, { form: filing.form, sourceUrl: targetUrl });
  }
}
