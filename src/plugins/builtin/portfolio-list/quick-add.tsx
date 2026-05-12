import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Input, Text, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { useAppDispatch, useAppSelector } from "../../../state/app-context";
import { getSharedRegistry } from "../../registry";
import { usePluginAppActions } from "../../plugin-runtime";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { formatMarketPrice } from "../../../utils/market-format";
import { resolveTickerSearch, upsertTickerFromSearchResult, type ResolvedTickerSearch } from "../../../utils/ticker-search";
import type { Quote } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { addTickerToPortfolio, addTickerToWatchlist } from "./mutations";

const QUICK_ADD_DEBOUNCE_MS = 300;
const QUICK_ADD_MAX_QUERY_LENGTH = 32;
const QUICK_ADD_SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-\s]*$/;

export type QuickAddCollectionKind = "portfolio" | "watchlist";

interface ResolvedQuickAdd {
  query: string;
  symbol: string;
  resolved: ResolvedTickerSearch;
  ticker: TickerRecord | null;
  quote: Quote | null;
}

type QuickAddValidation =
  | { status: "idle"; query: "" }
  | { status: "checking"; query: string }
  | (ResolvedQuickAdd & { status: "ready" | "duplicate" })
  | { status: "missing" | "error"; query: string; message: string };

const IDLE_VALIDATION: QuickAddValidation = { status: "idle", query: "" };

function normalizeQuickAddQuery(value: string): string {
  return value.replace(/^\s*\$/, "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isPlausibleTickerQuery(query: string): boolean {
  return query.length > 0
    && query.length <= QUICK_ADD_MAX_QUERY_LENGTH
    && QUICK_ADD_SYMBOL_RE.test(query);
}

function tickerBelongsToCollection(
  ticker: TickerRecord | null,
  collectionKind: QuickAddCollectionKind,
  collectionId: string,
): boolean {
  if (!ticker) return false;
  return collectionKind === "portfolio"
    ? ticker.metadata.portfolios.includes(collectionId)
    : ticker.metadata.watchlists.includes(collectionId);
}

function quoteContextFromResolved(resolved: ResolvedTickerSearch) {
  const instrument = resolved.kind === "provider"
    ? resolved.result.brokerContract
    : resolved.ticker.metadata.broker_contracts?.[0];
  return instrument
    ? {
        brokerId: instrument.brokerId,
        brokerInstanceId: instrument.brokerInstanceId,
        instrument,
      }
    : undefined;
}

function exchangeFromResolved(resolved: ResolvedTickerSearch): string | undefined {
  return resolved.kind === "provider"
    ? resolved.result.exchange
    : resolved.ticker.metadata.exchange;
}

function tickerNameFromValidation(validation: Extract<QuickAddValidation, { status: "ready" | "duplicate" }>): string {
  if (validation.ticker?.metadata.name) return validation.ticker.metadata.name;
  return validation.resolved.kind === "provider" ? validation.resolved.result.name : "";
}

function QuickAddPreview({
  validation,
  collectionKind,
  submitting,
}: {
  validation: QuickAddValidation;
  collectionKind: QuickAddCollectionKind;
  submitting: boolean;
}) {
  if (submitting) {
    return <Text fg={colors.textDim}>adding...</Text>;
  }

  if (validation.status === "idle") {
    return <Text fg={colors.textMuted}> </Text>;
  }

  if (validation.status === "checking") {
    return <Text fg={colors.textDim}>{`${validation.query} checking...`}</Text>;
  }

  if (validation.status === "missing" || validation.status === "error") {
    return <Text fg={colors.textMuted}>{validation.message}</Text>;
  }

  if (validation.status === "duplicate") {
    return <Text fg={colors.textMuted}>{`${validation.symbol} already in ${collectionKind}`}</Text>;
  }

  const quote = validation.quote;
  const assetCategory = validation.ticker?.metadata.assetCategory
    ?? (validation.resolved.kind === "provider" ? validation.resolved.result.type : undefined);
  const priceText = quote?.price != null
    ? formatMarketPrice(quote.price, { assetCategory, maxWidth: 12 })
    : "-";
  const changeValue = quote?.changePercent;
  const name = tickerNameFromValidation(validation);
  const showSymbol = normalizeQuickAddQuery(validation.symbol) !== validation.query;
  const symbolPrefix = showSymbol ? `${validation.symbol} ` : "";

  return (
    <Box flexDirection="row" overflow="hidden">
      <Text fg={colors.textDim}>{`${symbolPrefix}${priceText} `}</Text>
      <Text fg={changeValue == null ? colors.textDim : priceColor(changeValue)}>
        {formatPercentRaw(changeValue)}
      </Text>
      {name ? <Text fg={colors.textMuted}>{`  ${name}`}</Text> : null}
    </Box>
  );
}

export function QuickAddTickerInput({
  collectionId,
  collectionKind,
  collectionName,
  focused,
  width,
  onAdded,
  onFocusChange,
}: {
  collectionId: string;
  collectionKind: QuickAddCollectionKind;
  collectionName: string;
  focused: boolean;
  width: number;
  onAdded: (symbol: string) => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  const dispatch = useAppDispatch();
  const { notify } = usePluginAppActions();
  const tickers = useAppSelector((state) => state.tickers);
  const financials = useAppSelector((state) => state.financials);
  const inputRef = useRef<InputRenderable | null>(null);
  const validationSeqRef = useRef(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [validation, setValidation] = useState<QuickAddValidation>(IDLE_VALIDATION);
  const [submitting, setSubmitting] = useState(false);

  const focusInput = useCallback(() => {
    if (!focused) return;
    setInputFocused(true);
    queueMicrotask(() => inputRef.current?.focus?.());
  }, [focused]);

  const blurInput = useCallback(() => {
    setInputFocused(false);
  }, []);

  const resetInput = useCallback(() => {
    setInputValue("");
    setValidation(IDLE_VALIDATION);
  }, []);

  useEffect(() => {
    onFocusChange?.(inputFocused && focused);
  }, [focused, inputFocused, onFocusChange]);

  useEffect(() => {
    if (inputFocused && focused) {
      dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
      return () => dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
    }
  }, [dispatch, focused, inputFocused]);

  useEffect(() => {
    if (!focused && inputFocused) {
      blurInput();
    }
  }, [blurInput, focused, inputFocused]);

  const validateQuery = useCallback(async (query: string): Promise<QuickAddValidation> => {
    if (!query) return IDLE_VALIDATION;
    if (!isPlausibleTickerQuery(query)) {
      return { status: "missing", query, message: "Use a ticker symbol" };
    }

    const registry = getSharedRegistry();
    if (!registry) {
      return { status: "error", query, message: "Ticker lookup unavailable" };
    }

    try {
      const resolved = await resolveTickerSearch({
        query,
        activeTicker: null,
        tickers,
        dataProvider: registry.marketData,
      });
      if (!resolved) {
        return { status: "missing", query, message: "No exact ticker match" };
      }

      const symbol = resolved.symbol;
      const ticker = resolved.kind === "local" ? resolved.ticker : (tickers.get(symbol) ?? null);
      const cachedQuote = financials.get(symbol)?.quote ?? null;
      let quote = cachedQuote;
      if (!quote) {
        try {
          quote = await registry.marketData.getQuote(
            symbol,
            exchangeFromResolved(resolved),
            quoteContextFromResolved(resolved),
          );
        } catch {
          quote = null;
        }
      }

      return {
        status: tickerBelongsToCollection(ticker, collectionKind, collectionId) ? "duplicate" : "ready",
        query,
        symbol,
        resolved,
        ticker,
        quote,
      };
    } catch {
      return { status: "error", query, message: "Ticker lookup failed" };
    }
  }, [collectionId, collectionKind, financials, tickers]);

  useEffect(() => {
    const query = normalizeQuickAddQuery(inputValue);
    validationSeqRef.current += 1;
    const seq = validationSeqRef.current;

    if (!query) {
      setValidation(IDLE_VALIDATION);
      return;
    }

    if (!isPlausibleTickerQuery(query)) {
      setValidation({ status: "missing", query, message: "Use a ticker symbol" });
      return;
    }

    setValidation({ status: "checking", query });
    const timeoutId = setTimeout(() => {
      void validateQuery(query).then((result) => {
        if (validationSeqRef.current === seq) {
          setValidation(result);
        }
      });
    }, QUICK_ADD_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [inputValue, validateQuery]);

  const submitInput = useCallback(async (submittedValue?: string) => {
    const query = normalizeQuickAddQuery(submittedValue ?? inputValue);
    if (!query || submitting) return;

    setSubmitting(true);
    try {
      const currentValidation = (
        validation.query === query
        && (validation.status === "ready" || validation.status === "duplicate")
      )
        ? validation
        : await validateQuery(query);
      setValidation(currentValidation);

      if (currentValidation.status === "duplicate") {
        notify({ type: "info", body: `${currentValidation.symbol} is already in ${collectionName}.` });
        return;
      }
      if (currentValidation.status !== "ready") {
        notify({ type: "error", body: currentValidation.status === "idle" ? "Ticker symbol is required." : currentValidation.message });
        return;
      }

      const registry = getSharedRegistry();
      if (!registry) {
        notify({ type: "error", body: "Ticker lookup unavailable." });
        return;
      }

      let ticker: TickerRecord;
      let created = false;
      if (currentValidation.resolved.kind === "local") {
        ticker = currentValidation.resolved.ticker;
      } else {
        const result = await upsertTickerFromSearchResult(registry.tickerRepository, currentValidation.resolved.result);
        ticker = result.ticker;
        created = result.created;
      }

      const result = collectionKind === "portfolio"
        ? addTickerToPortfolio(ticker, collectionId)
        : addTickerToWatchlist(ticker, collectionId);

      if (!result.changed) {
        notify({ type: "info", body: `${ticker.metadata.ticker} is already in ${collectionName}.` });
        return;
      }

      await registry.tickerRepository.saveTicker(result.ticker);
      dispatch({ type: "UPDATE_TICKER", ticker: result.ticker });
      if (created) {
        registry.events.emit("ticker:added", {
          symbol: result.ticker.metadata.ticker,
          ticker: result.ticker,
        });
      }

      onAdded(result.ticker.metadata.ticker);
      notify({ type: "success", body: `Added ${result.ticker.metadata.ticker} to ${collectionName}.` });
      resetInput();
      queueMicrotask(() => inputRef.current?.focus?.());
    } catch {
      setValidation({ status: "error", query, message: "Ticker add failed" });
      notify({ type: "error", body: `Failed to add ${query}.` });
    } finally {
      setSubmitting(false);
    }
  }, [
    collectionId,
    collectionKind,
    collectionName,
    dispatch,
    inputValue,
    notify,
    onAdded,
    resetInput,
    submitting,
    validateQuery,
    validation,
  ]);

  useShortcut((event) => {
    if (!focused) return;

    if (inputFocused) {
      if (event.name === "escape") {
        event.preventDefault?.();
        event.stopPropagation?.();
        resetInput();
        blurInput();
      }
      return;
    }

    if (event.name === "n" && !event.ctrl && !event.meta && !event.super) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusInput();
    }
  });

  const inputWidth = useMemo(() => {
    const queryWidth = normalizeQuickAddQuery(inputValue).length;
    if (queryWidth > 0) {
      return Math.max(4, Math.min(18, queryWidth + 1));
    }
    return Math.max(6, Math.min(10, Math.floor(width * 0.18)));
  }, [inputValue, width]);
  const previewWidth = Math.max(8, width - inputWidth - 7);

  return (
    <Box
      height={1}
      width="100%"
      flexDirection="row"
      flexShrink={0}
      paddingX={1}
      backgroundColor={colors.panel}
      onMouseDown={(event: { preventDefault?: () => void }) => {
        event.preventDefault?.();
        focusInput();
      }}
    >
      <Text fg={inputFocused ? colors.text : colors.textDim}>+</Text>
      <Box width={1} />
      <Box width={inputWidth}>
        <Input
          ref={inputRef}
          value={inputValue}
          focused={inputFocused && focused}
          placeholder="ticker"
          placeholderColor={colors.textMuted}
          textColor={colors.text}
          backgroundColor={colors.panel}
          onInput={(value: string) => setInputValue(value.toUpperCase())}
          onChange={(value: string) => setInputValue(value.toUpperCase())}
          onSubmit={(value: string) => void submitInput(value)}
          onFocus={() => setInputFocused(true)}
          onBlur={blurInput}
        />
      </Box>
      <Box width={1} />
      <Box width={previewWidth} overflow="hidden">
        <QuickAddPreview
          validation={validation}
          collectionKind={collectionKind}
          submitting={submitting}
        />
      </Box>
    </Box>
  );
}
