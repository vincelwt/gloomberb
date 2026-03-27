import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { spawn, type Subprocess } from "bun";
import { execSync } from "child_process";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import { usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import { formatCurrency, formatCompact, formatPercent } from "../../utils/format";
import type { TickerFile } from "../../types/ticker";
import type { TickerFinancials } from "../../types/financials";
import { Spinner } from "../../components/spinner";

// --- AI Provider Detection ---

interface AiProvider {
  id: string;
  name: string;
  command: string;
  available: boolean;
  buildArgs: (prompt: string) => string[];
}

const PROVIDER_DEFS: Omit<AiProvider, "available">[] = [
  {
    id: "claude",
    name: "Claude",
    command: "claude",
    buildArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "gemini",
    name: "Gemini",
    command: "gemini",
    buildArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    buildArgs: (prompt) => ["exec", prompt],
  },
];

let _detectedProviders: AiProvider[] | null = null;

function detectProviders(): AiProvider[] {
  if (_detectedProviders) return _detectedProviders;

  _detectedProviders = PROVIDER_DEFS.map((def) => {
    let available = false;
    try {
      execSync(`command -v ${def.command}`, { stdio: "ignore" });
      available = true;
    } catch {}
    return { ...def, available };
  });

  return _detectedProviders;
}

// --- Context Builder ---

function buildContext(ticker: TickerFile, financials: TickerFinancials | null): string {
  const f = ticker.frontmatter;
  const q = financials?.quote;
  const fund = financials?.fundamentals;

  const lines: string[] = [
    `Company: ${f.name} (${f.ticker})`,
    `Exchange: ${f.exchange}`,
  ];

  if (f.sector) lines.push(`Sector: ${f.sector}`);
  if (f.industry) lines.push(`Industry: ${f.industry}`);

  if (q) {
    lines.push(`Current Price: ${formatCurrency(q.price, q.currency)} (${q.change >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%)`);
    if (q.marketCap) lines.push(`Market Cap: ${formatCompact(q.marketCap)}`);
    if (q.high52w && q.low52w) lines.push(`52W Range: ${formatCurrency(q.low52w, q.currency)} - ${formatCurrency(q.high52w, q.currency)}`);
  }

  if (fund) {
    if (fund.trailingPE) lines.push(`P/E (TTM): ${fund.trailingPE.toFixed(1)}`);
    if (fund.forwardPE) lines.push(`Forward P/E: ${fund.forwardPE.toFixed(1)}`);
    if (fund.pegRatio) lines.push(`PEG: ${fund.pegRatio.toFixed(2)}`);
    if (fund.revenue) lines.push(`Revenue: ${formatCompact(fund.revenue)}`);
    if (fund.netIncome) lines.push(`Net Income: ${formatCompact(fund.netIncome)}`);
    if (fund.eps) lines.push(`EPS: ${formatCurrency(fund.eps)}`);
    if (fund.operatingMargin != null) lines.push(`Operating Margin: ${formatPercent(fund.operatingMargin)}`);
    if (fund.profitMargin != null) lines.push(`Profit Margin: ${formatPercent(fund.profitMargin)}`);
    if (fund.freeCashFlow) lines.push(`Free Cash Flow: ${formatCompact(fund.freeCashFlow)}`);
    if (fund.dividendYield != null) lines.push(`Dividend Yield: ${formatPercent(fund.dividendYield)}`);
    if (fund.return1Y != null) lines.push(`1Y Return: ${formatPercent(fund.return1Y)}`);
  }

  // Add financial statements summary
  if (financials?.annualStatements && financials.annualStatements.length > 0) {
    const latest = financials.annualStatements[financials.annualStatements.length - 1]!;
    lines.push("");
    lines.push(`Latest Annual Statement (${latest.date}):`);
    if (latest.totalRevenue) lines.push(`  Revenue: ${formatCompact(latest.totalRevenue)}`);
    if (latest.netIncome) lines.push(`  Net Income: ${formatCompact(latest.netIncome)}`);
    if (latest.operatingCashFlow) lines.push(`  Operating CF: ${formatCompact(latest.operatingCashFlow)}`);
    if (latest.freeCashFlow) lines.push(`  Free Cash Flow: ${formatCompact(latest.freeCashFlow)}`);
    if (latest.totalAssets) lines.push(`  Total Assets: ${formatCompact(latest.totalAssets)}`);
    if (latest.totalDebt) lines.push(`  Total Debt: ${formatCompact(latest.totalDebt)}`);
    if (latest.totalEquity) lines.push(`  Equity: ${formatCompact(latest.totalEquity)}`);
  }

  if (ticker.notes) {
    lines.push("");
    lines.push(`User's Notes: ${ticker.notes}`);
  }

  return lines.join("\n");
}

// --- Chat State ---

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

// Per-ticker chat history (in memory only)
const chatHistories = new Map<string, ChatMessage[]>();

// --- Component ---

function AskAiTab({ width, height, focused, onCapture }: DetailTabProps) {
  const { ticker, financials } = usePaneTicker();
  const [providers] = useState(() => detectProviders());
  const [providerIdx, setProviderIdx] = useState(() => {
    const idx = providers.findIndex((p) => p.available);
    return idx >= 0 ? idx : 0;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<InputRenderable>(null);
  const procRef = useRef<Subprocess | null>(null);

  const tickerSymbol = ticker?.frontmatter.ticker ?? null;

  // Load chat history for current ticker
  useEffect(() => {
    if (tickerSymbol) {
      setMessages(chatHistories.get(tickerSymbol) || []);
    } else {
      setMessages([]);
    }
  }, [tickerSymbol]);

  // Save chat history when messages change
  useEffect(() => {
    if (tickerSymbol && messages.length > 0) {
      chatHistories.set(tickerSymbol, messages);
    }
  }, [tickerSymbol, messages]);

  const availableProviders = providers.filter((p) => p.available);
  const currentProvider = providers[providerIdx];

  const cycleProvider = useCallback(() => {
    if (availableProviders.length <= 1) return;
    setProviderIdx((idx) => {
      let next = (idx + 1) % providers.length;
      while (!providers[next]?.available) {
        next = (next + 1) % providers.length;
      }
      return next;
    });
  }, [providers, availableProviders.length]);

  const sendMessage = useCallback(async (text: string) => {
    if (!ticker || !currentProvider?.available) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const assistantMsg: ChatMessage = { role: "assistant", content: "", loading: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    // Build the full prompt with context
    const context = buildContext(ticker, financials);
    const fullPrompt = `You are a financial analyst assistant. Here is the current financial data for the company being discussed:\n\n${context}\n\nUser question: ${text}`;

    try {
      const args = currentProvider.buildArgs(fullPrompt);
      const proc = spawn([currentProvider.command, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      procRef.current = proc;

      // Read stdout incrementally
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let fullOutput = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullOutput += decoder.decode(value, { stream: true });
        const current = fullOutput;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: current, loading: true };
          return updated;
        });
      }

      // Finalize
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: fullOutput.trim() || "No response received.",
          loading: false,
        };
        return updated;
      });
    } catch (err: any) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `Error: ${err.message || "Failed to run AI command"}`,
          loading: false,
        };
        return updated;
      });
    } finally {
      procRef.current = null;
    }
  }, [ticker, financials, currentProvider]);

  // Handle keyboard
  useKeyboard((event) => {
    if (!focused) return;

    const isEnter = event.name === "enter" || event.name === "return";

    if (!inputFocused) {
      if (isEnter) {
        setInputFocused(true);
        onCapture(true);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      if (event.name === "t" || event.name === "T") {
        cycleProvider();
        return;
      }
    }

    if (inputFocused && event.name === "escape") {
      setInputFocused(false);
      onCapture(false);
      return;
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (procRef.current) {
        try { procRef.current.kill(); } catch {}
      }
    };
  }, []);

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to ask AI.</text>;

  if (availableProviders.length === 0) {
    return (
      <box flexDirection="column" padding={1} flexGrow={1}>
        <box height={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Ask AI</text>
        </box>
        <box height={1} />
        <text fg={colors.textDim}>No AI CLI tools detected. Install one of:</text>
        <box height={1} />
        <text fg={colors.text}>  claude  - Claude Code (claude.ai/claude-code)</text>
        <text fg={colors.text}>  gemini  - Gemini CLI (github.com/google-gemini/gemini-cli)</text>
        <text fg={colors.text}>  codex   - OpenAI Codex (github.com/openai/codex)</text>
      </box>
    );
  }

  const innerWidth = Math.max(width - 4, 40);
  // Reserve: header(1) + chat + divider(1) + input(1) + padding(2 top+bottom)
  const chatHeight = Math.max(height - 7, 4);

  const providerLabel = availableProviders.length > 1
    ? `${currentProvider?.name || "None"} (t to switch)`
    : currentProvider?.name || "None";

  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} height={height - 2}>
      {/* Header */}
      <box flexDirection="row" height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Ask AI</text>
        <box flexGrow={1} />
        <box onMouseDown={cycleProvider}>
          <text fg={colors.textMuted}>Provider: </text>
          <text fg={colors.textBright}>{providerLabel}</text>
        </box>
      </box>

      {/* Chat history */}
      <scrollbox height={chatHeight} scrollY>
        <box flexDirection="column">
          {messages.length === 0 ? (
            <box paddingTop={1}>
              <text fg={colors.textDim}>
                Ask questions about {ticker.frontmatter.ticker}. Financial data will be included as context.
              </text>
            </box>
          ) : (
            messages.map((msg, i) => (
              <box key={i} flexDirection="column" paddingTop={i > 0 ? 1 : 0}>
                <box height={1}>
                  <text
                    attributes={TextAttributes.BOLD}
                    fg={msg.role === "user" ? colors.textBright : colors.positive}
                  >
                    {msg.role === "user" ? "You" : currentProvider?.name || "AI"}
                    {msg.loading ? " (thinking...)" : ""}
                  </text>
                </box>
                <box>
                  {msg.content ? (
                    <text fg={colors.text}>{msg.content}</text>
                  ) : msg.loading ? (
                    <Spinner label="Generating..." />
                  ) : (
                    <text fg={colors.text}>{""}</text>
                  )}
                </box>
              </box>
            ))
          )}
        </box>
      </scrollbox>

      {/* Divider */}
      <box height={1}>
        <text fg={colors.textDim}>{"\u2500".repeat(innerWidth)}</text>
      </box>

      {/* Input area */}
      <box flexDirection="row" height={1}>
        <text fg={colors.textMuted}>{"> "}</text>
        <box flexGrow={1}>
          <input
            ref={inputRef}
            placeholder={inputFocused ? "Ask a question..." : "Enter to start typing"}
            focused={inputFocused}
            textColor={colors.text}
            placeholderColor={colors.textDim}
            backgroundColor={inputFocused ? colors.panel : colors.bg}
            onInput={(val) => setInputValue(val)}
            onChange={(val) => setInputValue(val)}
            onSubmit={() => {
              if (inputValue.trim()) {
                sendMessage(inputValue.trim());
                setInputValue("");
                if (inputRef.current) {
                  (inputRef.current as any).editBuffer?.setText?.("") || (inputRef.current as any).setText?.("");
                }
              }
            }}
          />
        </box>
      </box>
    </box>
  );
}

export const askAiPlugin: GloomPlugin = {
  id: "ask-ai",
  name: "Ask AI",
  version: "1.0.0",
  description: "Chat with AI about tickers using local CLI tools",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "ask-ai",
      name: "Ask AI",
      order: 60,
      component: AskAiTab,
    });
  },
};
