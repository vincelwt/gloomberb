import { describe, expect, test } from "bun:test";
import { buildGloomberbCliInstructions, resolveGloomberbCliCommand } from "./gloomberb-cli";
import {
  buildScreenerPrompt,
  mergeScreenerResults,
  parseScreenerResponse,
} from "./screener-contract";
import type { AiProvider } from "./providers";

const TEST_PROVIDER: AiProvider = {
  id: "claude",
  name: "Claude",
  command: "claude",
  available: true,
  buildArgs: () => [],
};

describe("AI screener helpers", () => {
  test("prefers the installed gloomberb command when it exists", () => {
    const command = resolveGloomberbCliCommand({
      cwd: "/tmp/project",
      hasCommand: (value) => value === "gloomberb",
      fileExists: () => true,
    });

    expect(command).toEqual({
      argv: ["gloomberb"],
      display: "gloomberb",
      mode: "installed",
    });
  });

  test("falls back to bun source mode while developing locally", () => {
    const command = resolveGloomberbCliCommand({
      cwd: "/tmp/project",
      hasCommand: () => false,
      fileExists: (path) => path === "/tmp/project/src/index.tsx",
    });

    expect(command).toEqual({
      argv: ["bun", "/tmp/project/src/index.tsx"],
      display: "bun /tmp/project/src/index.tsx",
      mode: "bun-source",
    });
    expect(buildGloomberbCliInstructions(command)).toContain("Inspect a portfolio or watchlist with: bun /tmp/project/src/index.tsx portfolio [name]");
  });

  test("builds a screener prompt with the current date and prior results", () => {
    const prompt = buildScreenerPrompt({
      currentDate: "2026-04-01",
      prompt: "Find profitable serial acquirers.",
      provider: TEST_PROVIDER,
      cliInstructions: [
        "Useful commands: gloomberb help",
        "Inspect a ticker with: gloomberb ticker <symbol>",
      ],
      previousResults: [
        {
          symbol: "CSU",
          exchange: "TSX",
          reason: "Recurring software roll-up.",
          resolvedName: "Constellation Software",
        },
      ],
      includePreviousResults: true,
    });

    expect(prompt).toContain("Today is 2026-04-01.");
    expect(prompt).toContain("You are running in the Claude CLI.");
    expect(prompt).toContain("Useful commands: gloomberb help");
    expect(prompt).toContain("CSU (TSX): Recurring software roll-up.");
    expect(prompt).toContain("Return raw JSON only.");
  });

  test("parses fenced JSON responses and normalizes ticker fields", () => {
    const parsed = parseScreenerResponse(`
\`\`\`json
{
  "title": "Compounders",
  "summary": "High quality names",
  "tickers": [
    { "symbol": " msft ", "exchange": " nasdaq ", "reason": "Recurring software cash flow" }
  ]
}
\`\`\`
`);

    expect(parsed).toEqual({
      title: "Compounders",
      summary: "High quality names",
      tickers: [
        {
          symbol: "MSFT",
          exchange: "NASDAQ",
          reason: "Recurring software cash flow",
        },
      ],
    });
  });

  test("merges reruns by updating duplicates and appending new symbols", () => {
    const merged = mergeScreenerResults(
      [
        { symbol: "AAPL", exchange: "NASDAQ", reason: "Old reason", resolvedName: "Apple Inc." },
      ],
      [
        { symbol: "AAPL", exchange: "NASDAQ", reason: "Updated reason", resolvedName: "Apple Inc." },
        { symbol: "MSFT", exchange: "NASDAQ", reason: "New result", resolvedName: "Microsoft Corp." },
      ],
    );

    expect(merged).toEqual([
      { symbol: "AAPL", exchange: "NASDAQ", reason: "Updated reason", resolvedName: "Apple Inc." },
      { symbol: "MSFT", exchange: "NASDAQ", reason: "New result", resolvedName: "Microsoft Corp." },
    ]);
  });
});
