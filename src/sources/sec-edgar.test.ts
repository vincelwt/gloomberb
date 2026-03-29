import { afterEach, describe, expect, test } from "bun:test";
import {
  SecEdgarClient,
  extractFilingContent,
  parseRecentFilings,
  parseTickerLookup,
} from "./sec-edgar";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseTickerLookup", () => {
  test("supports SEC field/data lookup payloads", () => {
    const lookup = parseTickerLookup({
      fields: ["cik", "name", "ticker", "exchange"],
      data: [
        [320193, "Apple Inc.", "AAPL", "Nasdaq"],
        [789019, "Microsoft Corp", "MSFT", "Nasdaq"],
      ],
    });

    expect(lookup.get("AAPL")).toEqual({
      cik: "0000320193",
      exchange: "Nasdaq",
      name: "Apple Inc.",
    });
    expect(lookup.get("MSFT")?.cik).toBe("0000789019");
  });

  test("supports legacy numbered lookup payloads", () => {
    const lookup = parseTickerLookup({
      "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    });

    expect(lookup.get("AAPL")?.name).toBe("Apple Inc.");
    expect(lookup.get("AAPL")?.cik).toBe("0000320193");
  });
});

describe("parseRecentFilings", () => {
  test("maps SEC columnar submissions data into filing items", () => {
    const filings = parseRecentFilings({
      cik: "0000320193",
      name: "Apple Inc.",
      filings: {
        recent: {
          accessionNumber: ["0000320193-24-000123"],
          form: ["8-K"],
          filingDate: ["2024-08-01"],
          acceptanceDateTime: ["20240801163045"],
          primaryDocument: ["aapl-8k.htm"],
          primaryDocDescription: ["Current report"],
          items: ["2.02,9.01"],
        },
      },
    });

    expect(filings).toHaveLength(1);
    expect(filings[0]?.form).toBe("8-K");
    expect(filings[0]?.filingUrl).toBe("https://www.sec.gov/Archives/edgar/data/320193/0000320193-24-000123-index.htm");
    expect(filings[0]?.primaryDocumentUrl).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-8k.htm");
  });
});

describe("SecEdgarClient", () => {
  test("extracts readable text from filing html", () => {
    const content = extractFilingContent(`
      <html>
        <body>
          <h1>FORM 8-K</h1>
          <p>Item 2.02 Results of Operations and Financial Condition.</p>
          <p>Revenue increased 12% year over year.</p>
        </body>
      </html>
    `, "text/html");

    expect(content).toContain("FORM 8-K");
    expect(content).toContain("Revenue increased 12% year over year.");
  });

  test("drops hidden inline xbrl boilerplate from filing html", () => {
    const content = extractFilingContent(`
      <?xml version="1.0"?>
      <html>
        <body>
          <h5><a href="#toc">Table of Contents</a></h5>
          <div style="display: none">
            <ix:header>
              <ix:hidden>
                <ix:nonNumeric name="dei:DocumentType">DEF 14A</ix:nonNumeric>
                <ix:nonNumeric name="dei:AmendmentFlag">false</ix:nonNumeric>
              </ix:hidden>
              <ix:resources>
                <xbrli:context id="P1">ecd:ChngInFrValOfOutsdngAndUnvstdEqtyAwrdsGrntdInPrrYrsMember ecd:PeoMember</xbrli:context>
              </ix:resources>
            </ix:header>
          </div>
          <div>
            <div>UNITED STATES</div>
            <div>SECURITIES AND EXCHANGE COMMISSION</div>
            <div>SCHEDULE 14A</div>
            <p>Definitive Proxy Statement</p>
          </div>
        </body>
      </html>
    `, "text/html", { form: "DEF 14A" });

    expect(content).toContain("UNITED STATES");
    expect(content).toContain("SCHEDULE 14A");
    expect(content).not.toContain("ecd:ChngInFrValOfOutsdngAndUnvstdEqtyAwrdsGrntdInPrrYrsMember");
    expect(content).not.toContain("false");
  });

  test("returns a clean fallback message for pdf filings", () => {
    const content = extractFilingContent("%PDF-1.6\u0000\u0000\u0000", "application/pdf", {
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/2488/example.pdf",
    });

    expect(content).toContain("primary document is a PDF");
    expect(content).not.toContain("%PDF-1.6");
  });

  test("summarizes ownership xml filings cleanly", () => {
    const content = extractFilingContent(`
      <?xml version="1.0"?>
      <ownershipDocument>
        <issuer>
          <issuerName>Realty Income Corp</issuerName>
          <issuerTradingSymbol>O</issuerTradingSymbol>
        </issuer>
        <periodOfReport>2026-03-12</periodOfReport>
        <reportingOwner>
          <reportingOwnerId>
            <rptOwnerName>Jane Doe</rptOwnerName>
          </reportingOwnerId>
        </reportingOwner>
        <nonDerivativeTable>
          <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-03-12</value></transactionDate>
            <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
            <transactionAmounts>
              <transactionShares><value>16228</value></transactionShares>
              <transactionPricePerShare><value>197.42</value></transactionPricePerShare>
              <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
              <sharesOwnedFollowingTransaction><value>3214778</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
              <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
          </nonDerivativeTransaction>
        </nonDerivativeTable>
      </ownershipDocument>
    `, "text/xml", { form: "4" });

    expect(content).toContain("Form 4 | Realty Income Corp | O");
    expect(content).toContain("Owner Jane Doe");
    expect(content).toContain("Common Stock | 2026-03-12 | Code S | 16228 shares D | @ 197.42 | Owned 3214778 | Ownership Direct");
  });

  test("loads a company's recent filings by ticker", async () => {
    let callCount = 0;
    const headersSeen: Array<Record<string, string>> = [];
    globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
      callCount += 1;
      const url = String(input);
      headersSeen.push((init?.headers ?? {}) as Record<string, string>);
      if (url.includes("company_tickers_exchange.json")) {
        return new Response(JSON.stringify({
          fields: ["cik", "name", "ticker", "exchange"],
          data: [[320193, "Apple Inc.", "AAPL", "Nasdaq"]],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        cik: "0000320193",
        name: "Apple Inc.",
        filings: {
          recent: {
            accessionNumber: ["0000320193-24-000123"],
            form: ["10-Q"],
            filingDate: ["2024-08-02"],
            acceptanceDateTime: ["20240802120000"],
            primaryDocument: ["aapl-10q.htm"],
            primaryDocDescription: ["Quarterly report"],
            items: [""],
          },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new SecEdgarClient();
    const filings = await client.getRecentFilings("AAPL", 1);

    expect(callCount).toBe(2);
    expect(filings).toHaveLength(1);
    expect(filings[0]?.form).toBe("10-Q");
    expect(headersSeen[0]?.["User-Agent"]).toBeTruthy();
    expect(headersSeen[0]?.From).toBeTruthy();
  });

  test("surfaces SEC bot blocking errors clearly", async () => {
    globalThis.fetch = (async () => new Response(
      "<html><body>Undeclared Automated Tool</body></html>",
      {
        status: 200,
        headers: { "content-type": "text/html" },
      },
    )) as unknown as typeof fetch;

    const client = new SecEdgarClient();

    await expect(client.getRecentFilings("AAPL", 1)).rejects.toThrow("SEC blocked the request");
  });

  test("loads filing body content", async () => {
    globalThis.fetch = (async (input: Request | string | URL) => new Response(
      String(input).includes("primary-doc")
        ? "<html><body><h1>Quarterly Report</h1><p>Net sales increased.</p></body></html>"
        : JSON.stringify({
            fields: ["cik", "name", "ticker", "exchange"],
            data: [[320193, "Apple Inc.", "AAPL", "Nasdaq"]],
          }),
      {
        status: 200,
        headers: {
          "content-type": String(input).includes("primary-doc") ? "text/html" : "application/json",
        },
      },
    )) as unknown as typeof fetch;

    const client = new SecEdgarClient();
    const content = await client.getFilingContent({
      filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/index.htm",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/320193/primary-doc.htm",
    });

    expect(content).toContain("Quarterly Report");
    expect(content).toContain("Net sales increased.");
  });

  test("falls back from a pdf primary document to an alternate html document", async () => {
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("-index.htm")) {
        return new Response(`
          <html>
            <body>
              <a href="/Archives/edgar/data/2488/example.pdf">example.pdf</a>
              <a href="/Archives/edgar/data/2488/example.htm">example.htm</a>
            </body>
          </html>
        `, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return new Response("<html><body><h1>Proxy Statement</h1><p>Annual meeting details.</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;

    const client = new SecEdgarClient();
    const content = await client.getFilingContent({
      filingUrl: "https://www.sec.gov/Archives/edgar/data/2488/0000000000-26-000001-index.htm",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/2488/example.pdf",
      form: "DEF 14A",
    });

    expect(content).toContain("Proxy Statement");
    expect(content).toContain("Annual meeting details.");
  });
});
