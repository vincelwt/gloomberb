import type { GloomPlugin, GloomPluginContext } from "../../types/plugin";
import type { BrokerAdapter, BrokerPosition } from "../../types/broker";

const IBKR_STATEMENT_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest";
const IBKR_STATEMENT_GET_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";

interface FlexQueryConfig {
  token: string;
  queryId: string;
  endpoint?: string;
}

async function requestFlexStatement(config: FlexQueryConfig): Promise<string> {
  const endpoint = config.endpoint || IBKR_STATEMENT_URL;
  const url = `${endpoint}?t=${config.token}&q=${config.queryId}&v=3`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await resp.text();

  const codeMatch = text.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/);
  if (!codeMatch) {
    const errorMatch = text.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/);
    throw new Error(errorMatch?.[1] || "Failed to request Flex statement");
  }
  return codeMatch[1]!;
}

async function getFlexStatement(token: string, referenceCode: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 3000));

  const url = `${IBKR_STATEMENT_GET_URL}?t=${token}&q=${referenceCode}&v=3`;

  for (let i = 0; i < 5; i++) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const text = await resp.text();

    if (text.includes("<FlexQueryResponse") || text.includes("<FlexStatements")) {
      return text;
    }

    if (text.includes("Statement generation in progress")) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      continue;
    }

    const errorMatch = text.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/);
    if (errorMatch) throw new Error(errorMatch[1]);
  }

  throw new Error("Flex statement generation timed out");
}

function parseFlexPositions(xml: string): BrokerPosition[] {
  const positions: BrokerPosition[] = [];

  const posRegex = /<OpenPosition[^>]*>/g;
  let match;

  while ((match = posRegex.exec(xml)) !== null) {
    const tag = match[0];
    const attr = (name: string) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`));
      return m?.[1] || "";
    };
    const numAttr = (name: string) => {
      const v = attr(name);
      if (!v) return undefined;
      const n = parseFloat(v);
      return Number.isNaN(n) ? undefined : n;
    };

    const symbol = attr("symbol");
    const quantity = parseFloat(attr("position") || attr("quantity") || "0");
    const costBasis = parseFloat(attr("costBasisPrice") || attr("costPrice") || "0");
    const currency = attr("currency") || "USD";
    const exchange = attr("listingExchange") || attr("exchange") || "";
    const accountId = attr("accountId");
    const description = attr("description");
    const assetCategory = attr("assetCategory");
    const isin = attr("isin") || attr("securityID");
    const side = attr("side")?.toLowerCase();
    const markPrice = numAttr("markPrice");
    const marketValue = numAttr("positionValue");
    const unrealizedPnl = numAttr("fifoPnlUnrealized") ?? numAttr("unrealizedCapitalGainsPnl");
    const fxRateToBase = numAttr("fxRateToBase");
    const multiplier = numAttr("multiplier");
    const percentOfNav = numAttr("percentOfNAV");

    if (symbol && quantity !== 0) {
      positions.push({
        ticker: symbol,
        exchange,
        shares: Math.abs(quantity),
        avgCost: costBasis,
        currency,
        accountId: accountId || undefined,
        name: description || undefined,
        assetCategory: assetCategory || undefined,
        isin: isin || undefined,
        side: side === "long" || side === "short" ? side : undefined,
        markPrice,
        marketValue,
        unrealizedPnl,
        fxRateToBase,
        multiplier,
        percentOfNav,
      });
    }
  }

  return positions;
}

const ibkrBroker: BrokerAdapter = {
  id: "ibkr-flex",
  name: "Interactive Brokers (Flex Query)",

  async validate(config) {
    const { token, queryId } = config as unknown as FlexQueryConfig;
    return !!(token && queryId);
  },

  async importPositions(config): Promise<BrokerPosition[]> {
    const { token, queryId, endpoint } = config as unknown as FlexQueryConfig;
    const referenceCode = await requestFlexStatement({ token, queryId, endpoint });
    const xml = await getFlexStatement(token, referenceCode);
    return parseFlexPositions(xml);
  },

  configSchema: [
    { key: "token", label: "Flex Token", type: "password", required: true, placeholder: "Your Flex Web Service token" },
    { key: "queryId", label: "Query ID", type: "text", required: true, placeholder: "Flex Query ID" },
    { key: "endpoint", label: "Endpoint", type: "text", required: false, placeholder: IBKR_STATEMENT_URL },
  ],
};

export const ibkrFlexPlugin: GloomPlugin = {
  id: "ibkr-flex",
  name: "IBKR Flex Query",
  version: "1.0.0",
  broker: ibkrBroker,

  setup(ctx) {
    ctx.registerCommand({
      id: "ibkr-setup",
      label: "IBKR Setup",
      description: "Connect Interactive Brokers to sync positions",
      keywords: ["ibkr", "interactive brokers", "broker", "flex", "setup", "configure", "connect"],
      category: "config",
      wizard: [
        {
          key: "_intro",
          label: "Connect Interactive Brokers",
          type: "info",
          body: [
            "This will connect your IBKR account to automatically",
            "sync your open positions. You'll need two things from",
            "the IBKR Client Portal:",
            "",
            "1. A Flex Query (with Open Positions selected)",
            "2. A Flex Web Service token",
            "",
            "To set these up, log into Client Portal and go to:",
            "  Performance & Reports > Flex Queries",
            "",
            "  interactivebrokers.com/sso/resolver",
            "",
            "Create an Activity Flex Query with:",
            "  - Output format: XML",
            "  - Sections: Open Positions (select all fields)",
            "",
            "Then under Flex Web Service, generate a token.",
            "Set expiry to 1 year to avoid frequent re-auth.",
          ],
        },
        {
          key: "token",
          label: "Flex Web Service Token",
          type: "password",
          placeholder: "Paste token from Flex Web Service section",
          body: [
            "In Client Portal > Flex Queries, look for the",
            "\"Flex Web Service\" section on the right side.",
            "Click \"Generate New Token\" if you don't have one.",
            "",
            "Tip: set token expiry to 1 year for uninterrupted sync.",
          ],
        },
        {
          key: "queryId",
          label: "Flex Query ID",
          type: "text",
          placeholder: "Numeric query ID (e.g. 1404268)",
          body: [
            "Click the info icon next to your Activity Flex Query",
            "to find the Query ID. It's a numeric value.",
          ],
        },
        {
          key: "_validate",
          label: "Testing Connection",
          type: "info",
          body: [
            "Connecting to Interactive Brokers...",
          ],
        },
      ],
      execute: async (values) => {
        if (!values?.token || !values?.queryId) return;

        // Save credentials first
        await ctx.updateBrokerConfig("ibkr-flex", {
          token: values.token,
          queryId: values.queryId,
        });

        // Validate by actually requesting the statement
        await requestFlexStatement({
          token: values.token,
          queryId: values.queryId,
        });

        // Immediately sync positions
        await ctx.syncBroker("ibkr-flex");
      },
    });
  },
};
