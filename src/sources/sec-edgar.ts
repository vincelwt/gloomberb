import { hostname } from "os";
import type { SecFilingItem } from "../types/data-provider";

const LOOKUP_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_CHARS = 16_000;
const OWNERSHIP_FORMS = new Set(["3", "3/A", "4", "4/A", "5", "5/A"]);
const PDF_FALLBACK_MESSAGE = "This filing's primary document is a PDF. Inline PDF extraction is not supported here; open the filing URL below to view the full document.";

function sanitizeIdentityPart(value: string, fallback: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function extractEmail(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ?? null;
}

const DEFAULT_SEC_FROM =
  process.env.SEC_FROM_EMAIL?.trim()
  || extractEmail(process.env.SEC_USER_AGENT)
  || `${sanitizeIdentityPart(process.env.USER ?? "gloomberb", "gloomberb")}@${sanitizeIdentityPart(`${hostname()}.local`, "localhost.localdomain")}`;

export const DEFAULT_SEC_USER_AGENT =
  process.env.SEC_USER_AGENT?.trim()
  || `Gloomberb/0.1 (${sanitizeIdentityPart(hostname(), "localhost")}; contact=${DEFAULT_SEC_FROM})`;

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

function truncateWithEllipsis(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function stripAccessionDashes(accessionNumber: string): string {
  return accessionNumber.replace(/-/g, "");
}

function isHtmlResponse(body: string): boolean {
  return /^\s*<!DOCTYPE html/i.test(body) || /^\s*<html/i.test(body);
}

function isPdfDocument(body: string, contentType = "", url = ""): boolean {
  return /pdf/i.test(contentType)
    || /\.pdf(?:$|[?#])/i.test(url)
    || /^\s*%PDF-/i.test(body)
    || /^\s*begin 644 [^\n]+\.pdf/im.test(body)
    || /<PDF>/i.test(body);
}

function isSecBlockMessage(body: string): boolean {
  return /Undeclared Automated Tool|Request Rate Threshold Exceeded/i.test(body);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decodeHtmlEntities(text: string): string {
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

function collapseDocumentLines(text: string): string[] {
  const rawLines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const lines: string[] = [];

  for (const line of rawLines) {
    if (lines[lines.length - 1] === line) continue;
    if (/^(xmlns|schemaRef|contextRef|unitRef|xsi:|ix:header|link:schemaRef|xbrli:|xbrldi:|xlink:|ix:|ixt:|ixt-sec:|dei:|ecd:|us-gaap:|iso4217:|srt:|country:|utr:|xl:)/i.test(line)) continue;
    if (/^(?:[a-z]{2,10}:[A-Za-z0-9][\w.-]*)(?:\s+[a-z]{2,10}:[A-Za-z0-9][\w.-]*){2,}$/i.test(line)) continue;
    if (/^LOGO$/i.test(line)) continue;
    lines.push(line);
  }

  return lines;
}

function trimLeadingNoise(lines: string[]): string[] {
  const startIndex = lines.findIndex((line) => /^(UNITED STATES|FORM [0-9A-Z-]+|SCHEDULE 14A|PROXY STATEMENT|NOTICE OF|ANNUAL REPORT|QUARTERLY REPORT|CURRENT REPORT)/i.test(line));
  if (startIndex <= 0) return lines;

  const prefix = lines.slice(0, startIndex);
  const noiseCount = prefix.filter((line) => /^Table of Contents$/i.test(line) || line.length < 5).length;
  return noiseCount >= Math.max(1, prefix.length - 1)
    ? lines.slice(startIndex)
    : lines;
}

function getTagInner(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ?? null;
}

function getTagInners(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
}

function cleanXmlText(text: string): string {
  return decodeHtmlEntities(
    text
      .replace(/<footnoteId[^>]*\/>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim(),
  );
}

function extractXmlValue(xml: string, path: string[]): string | null {
  let current: string | null = xml;
  for (const tag of path) {
    current = current ? getTagInner(current, tag) : null;
    if (!current) return null;
  }

  const nestedValue = getTagInner(current, "value");
  const text = cleanXmlText(nestedValue ?? current);
  return text || null;
}

function formatOwnershipCode(value: string | null): string | null {
  if (!value) return null;
  if (value === "D") return "Direct";
  if (value === "I") return "Indirect";
  return value;
}

function formatOwnershipTransaction(section: string): string | null {
  const security = extractXmlValue(section, ["securityTitle"]);
  const date = extractXmlValue(section, ["transactionDate"]);
  const code = extractXmlValue(section, ["transactionCoding", "transactionCode"]);
  const shares = extractXmlValue(section, ["transactionAmounts", "transactionShares"]);
  const action = extractXmlValue(section, ["transactionAmounts", "transactionAcquiredDisposedCode"]);
  const price = extractXmlValue(section, ["transactionAmounts", "transactionPricePerShare"]);
  const owned = extractXmlValue(section, ["postTransactionAmounts", "sharesOwnedFollowingTransaction"]);
  const ownership = formatOwnershipCode(extractXmlValue(section, ["ownershipNature", "directOrIndirectOwnership"]));
  const nature = extractXmlValue(section, ["ownershipNature", "natureOfOwnership"]);

  const segments = [
    security,
    date,
    code ? `Code ${code}` : null,
    shares ? `${shares} shares${action ? ` ${action}` : ""}` : action ? `Action ${action}` : null,
    price ? `@ ${price}` : null,
    owned ? `Owned ${owned}` : null,
    ownership ? `Ownership ${ownership}` : null,
    nature ? `Nature ${nature}` : null,
  ].filter((value): value is string => !!value);

  return segments.length > 0 ? `- ${segments.join(" | ")}` : null;
}

function formatOwnershipHolding(section: string): string | null {
  const security = extractXmlValue(section, ["securityTitle"]);
  const owned = extractXmlValue(section, ["postTransactionAmounts", "sharesOwnedFollowingTransaction"]);
  const ownership = formatOwnershipCode(extractXmlValue(section, ["ownershipNature", "directOrIndirectOwnership"]));
  const nature = extractXmlValue(section, ["ownershipNature", "natureOfOwnership"]);

  const segments = [
    security,
    owned ? `Owned ${owned}` : null,
    ownership ? `Ownership ${ownership}` : null,
    nature ? `Nature ${nature}` : null,
  ].filter((value): value is string => !!value);

  return segments.length > 0 ? `- ${segments.join(" | ")}` : null;
}

function extractOwnershipDocumentSummary(document: string, form: string): string | null {
  if (!/<ownershipDocument[\s>]/i.test(document) || !OWNERSHIP_FORMS.has(form.toUpperCase())) return null;

  const lines: string[] = [];
  const issuerName = extractXmlValue(document, ["issuer", "issuerName"]) ?? extractXmlValue(document, ["issuerName"]);
  const symbol = extractXmlValue(document, ["issuer", "issuerTradingSymbol"]) ?? extractXmlValue(document, ["issuerTradingSymbol"]);
  const reportDate = extractXmlValue(document, ["periodOfReport"]);
  const ownerName = extractXmlValue(document, ["reportingOwner", "reportingOwnerId", "rptOwnerName"])
    ?? extractXmlValue(document, ["rptOwnerName"]);

  lines.push([`Form ${form}`, issuerName, symbol].filter(Boolean).join(" | "));
  if (reportDate) lines.push(`Report date ${reportDate}`);
  if (ownerName) lines.push(`Owner ${ownerName}`);

  const transactionLines = getTagInners(document, "nonDerivativeTransaction")
    .map((section) => formatOwnershipTransaction(section))
    .filter((value): value is string => !!value);

  const holdingLines = getTagInners(document, "nonDerivativeHolding")
    .map((section) => formatOwnershipHolding(section))
    .filter((value): value is string => !!value);

  if (transactionLines.length > 0) {
    lines.push("", "Transactions", ...transactionLines.slice(0, 12));
  } else if (holdingLines.length > 0) {
    lines.push("", "Holdings", ...holdingLines.slice(0, 12));
  }

  const result = lines.filter(Boolean).join("\n");
  return result || null;
}

export function extractFilingContent(
  document: string,
  contentType = "",
  options: { form?: string; sourceUrl?: string } = {},
): string | null {
  if (isPdfDocument(document, contentType, options.sourceUrl)) {
    return PDF_FALLBACK_MESSAGE;
  }

  const ownershipSummary = options.form ? extractOwnershipDocumentSummary(document, options.form) : null;
  if (ownershipSummary) return ownershipSummary;

  const looksLikeMarkup = /html|xml/i.test(contentType) || /^\s*</.test(document);
  let text = document;

  if (looksLikeMarkup) {
    text = text
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, " ")
      .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
      .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
      .replace(/<ix:references[\s\S]*?<\/ix:references>/gi, " ")
      .replace(/<ix:resources[\s\S]*?<\/ix:resources>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|section|article|header|footer|li|tr|table|h\d|title)>/gi, "\n")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<(p|div|section|article|header|footer|li|tr|table|h\d|title)[^>]*>/gi, "\n")
      .replace(/<td[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }

  const lines = trimLeadingNoise(collapseDocumentLines(decodeHtmlEntities(text)));
  if (lines.length === 0) return null;

  let result = lines.join("\n");
  if (result.length > MAX_CONTENT_CHARS) {
    result = `${result.slice(0, MAX_CONTENT_CHARS).trimEnd()}\n\n[truncated]`;
  }
  return result;
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

  async getFilingContent(filing: Pick<SecFilingItem, "primaryDocumentUrl" | "filingUrl" | "form">): Promise<string | null> {
    const targetUrl = filing.primaryDocumentUrl || filing.filingUrl;
    if (!targetUrl) return null;

    if (filing.primaryDocumentUrl && isPdfDocument("", "", filing.primaryDocumentUrl)) {
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
