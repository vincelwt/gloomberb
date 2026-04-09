import { useState, useRef, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { useDialogKeyboard, type PromptContext } from "@opentui-ui/dialog/react";
import type { Quote } from "../types/financials";
import { colors } from "../theme/colors";
import { formatMarketPrice } from "../utils/market-format";
import { DialogFrame, ListView, NumberField } from "./ui";
import { padTo } from "../utils/format";

interface PricePreset {
  label: string;
  value: number;
  detail?: string;
}

export interface PriceSelectorDialogProps {
  label: string;
  currentValue?: number;
  quote?: Quote;
  assetCategory?: string;
}

function buildPresets(quote: Quote | undefined): PricePreset[] {
  if (!quote) return [];
  const presets: PricePreset[] = [];
  if (quote.bid != null && quote.bid > 0) {
    presets.push({ label: "Bid", value: quote.bid, detail: quote.bidSize != null ? `× ${quote.bidSize}` : undefined });
  }
  if (quote.ask != null && quote.ask > 0) {
    presets.push({ label: "Ask", value: quote.ask, detail: quote.askSize != null ? `× ${quote.askSize}` : undefined });
  }
  if (quote.price > 0) {
    presets.push({ label: "Last", value: quote.price });
  }
  if (quote.mark != null && quote.mark > 0) {
    presets.push({ label: "Mark", value: quote.mark });
  }
  if (quote.high != null && quote.high > 0) {
    presets.push({ label: "High", value: quote.high });
  }
  if (quote.low != null && quote.low > 0) {
    presets.push({ label: "Low", value: quote.low });
  }
  if (quote.previousClose != null && quote.previousClose > 0) {
    presets.push({ label: "Prev Close", value: quote.previousClose });
  }
  return presets;
}

function formatMarketContext(quote: Quote | undefined, assetCategory?: string): string {
  if (!quote) return "No quote data available";
  const parts: string[] = [];
  parts.push(`Last ${formatMarketPrice(quote.price, { assetCategory })}`);
  if (quote.bid != null) {
    const bidValue = formatMarketPrice(quote.bid, { assetCategory });
    const bidStr = quote.bidSize != null ? `Bid ${bidValue} × ${quote.bidSize}` : `Bid ${bidValue}`;
    parts.push(bidStr);
  }
  if (quote.ask != null) {
    const askValue = formatMarketPrice(quote.ask, { assetCategory });
    const askStr = quote.askSize != null ? `Ask ${askValue} × ${quote.askSize}` : `Ask ${askValue}`;
    parts.push(askStr);
  }
  if (quote.bid != null && quote.ask != null) {
    parts.push(`Spd ${formatMarketPrice(quote.ask - quote.bid, { assetCategory })}`);
  }
  return parts.join(" · ");
}

const CUSTOM_INDEX = -1;

export function PriceSelectorDialog({
  resolve,
  dialogId,
  label,
  currentValue,
  quote,
  assetCategory,
}: PromptContext<string> & PriceSelectorDialogProps) {
  const presets = buildPresets(quote);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"list" | "input">(presets.length > 0 ? "list" : "input");
  const [customValue, setCustomValue] = useState("");
  const inputRef = useRef<InputRenderable>(null);

  useEffect(() => {
    if (mode === "input") inputRef.current?.focus();
  }, [mode]);

  useDialogKeyboard((event) => {
    event.stopPropagation();

    if (event.name === "escape") {
      resolve("");
      return;
    }

    if (mode === "list") {
      if (event.name === "up" || event.name === "k") {
        setIndex((current) => Math.max(0, current - 1));
      } else if (event.name === "down" || event.name === "j") {
        if (index < presets.length - 1) {
          setIndex((current) => current + 1);
        } else {
          setMode("input");
          setIndex(CUSTOM_INDEX);
        }
      } else if (event.name === "return") {
        if (presets[index]) {
          resolve(String(presets[index].value));
        }
      } else if (event.name === "tab") {
        setMode("input");
        setIndex(CUSTOM_INDEX);
      } else if (event.sequence && /^[0-9.]$/.test(event.sequence)) {
        setMode("input");
        setIndex(CUSTOM_INDEX);
        setCustomValue(event.sequence);
      }
    } else {
      if (event.name === "up" || (event.name === "tab" && presets.length > 0)) {
        setMode("list");
        setIndex(presets.length - 1);
      } else if (event.name === "return") {
        resolve(customValue.trim());
      }
    }
  }, dialogId);

  const presetWidth = 12;

  return (
    <DialogFrame
      title={label}
      footer={
        mode === "list"
          ? "↑↓ or hover to choose · Enter/click select · Tab or ↓ for custom · Esc cancel"
          : "Type a price · Enter confirm · ↑ or Tab back to presets · Esc cancel"
      }
    >
      <box flexDirection="column">
        <text fg={colors.textDim}>{formatMarketContext(quote, assetCategory)}</text>
        <box height={1} />

        {presets.length > 0 && (
          <>
            <ListView
              items={presets.map((preset) => ({
                id: preset.label,
                label: preset.label,
              }))}
              selectedIndex={mode === "list" ? index : -1}
              bgColor={colors.bg}
              onSelect={(nextIndex) => {
                setMode("list");
                setIndex(nextIndex);
              }}
              onActivate={(_, nextIndex) => resolve(String(presets[nextIndex]?.value ?? ""))}
              renderRow={(item, state) => {
                const preset = presets.find((entry) => entry.label === item.id);
                return (
                  <box flexDirection="row">
                    <text fg={state.selected ? colors.selectedText : colors.textDim}>
                      {state.selected ? "▸ " : "  "}
                    </text>
                    <text fg={state.selected ? colors.text : colors.textDim} attributes={state.selected ? TextAttributes.BOLD : 0}>
                      {padTo(item.label, presetWidth)}
                    </text>
                    <text fg={state.selected ? colors.text : colors.textMuted}>
                      {preset ? formatMarketPrice(preset.value, { assetCategory }) : ""}
                    </text>
                    {preset?.detail && (
                      <text fg={colors.textDim}>{`  ${preset.detail}`}</text>
                    )}
                  </box>
                );
              }}
            />
            <box height={1} />
          </>
        )}

        <box flexDirection="row" onMouseDown={() => { setMode("input"); setIndex(CUSTOM_INDEX); }}>
          <text fg={mode === "input" ? colors.text : colors.textDim}>
            {mode === "input" ? "▸ " : "  "}Custom:{" "}
          </text>
          <NumberField
            inputRef={inputRef}
            focused={mode === "input"}
            value={customValue}
            placeholder={currentValue != null ? String(currentValue) : "type a price"}
            onChange={setCustomValue}
            onSubmit={(submittedValue) => resolve(submittedValue.trim())}
          />
        </box>
      </box>
    </DialogFrame>
  );
}
