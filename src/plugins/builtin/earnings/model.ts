import type { EarningsEvent } from "../../../types/data-provider";
import { parseTickerListInput } from "../../../utils/ticker-list";

export type EarningsDisplayRow =
  | { kind: "separator"; key: string; label: string }
  | { kind: "event"; key: string; event: EarningsEvent; eventIdx: number };

export type EarningsEventDisplayRow = EarningsDisplayRow & { kind: "event" };

export function resolveEarningsMonitorSymbols(scopedSymbols: string[], fallbackSymbols: string[]): string[] {
  return scopedSymbols.length > 0 ? scopedSymbols : fallbackSymbols;
}

export function scopedSymbolsFromSettings(settings: Record<string, unknown> | undefined): string[] {
  const symbols = settings?.symbols;
  if (Array.isArray(symbols)) {
    return symbols
      .filter((symbol): symbol is string => typeof symbol === "string" && symbol.trim().length > 0)
      .map((symbol) => symbol.trim().toUpperCase());
  }
  const symbolsText = settings?.symbolsText;
  if (typeof symbolsText !== "string" || !symbolsText.trim()) return [];
  try {
    return parseTickerListInput(symbolsText);
  } catch {
    return [];
  }
}

export function groupEarningsByRelativeDate(events: EarningsEvent[]): EarningsDisplayRow[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
  const endOfNextWeek = new Date(endOfWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  const groups: { label: string; events: EarningsEvent[] }[] = [
    { label: "TODAY", events: [] },
    { label: "TOMORROW", events: [] },
    { label: "THIS WEEK", events: [] },
    { label: "NEXT WEEK", events: [] },
    { label: "LATER", events: [] },
  ];

  for (const event of events) {
    const date = event.earningsDate;
    if (date >= today && date < tomorrow) {
      groups[0]!.events.push(event);
    } else if (date >= tomorrow && date < dayAfterTomorrow) {
      groups[1]!.events.push(event);
    } else if (date >= dayAfterTomorrow && date < endOfWeek) {
      groups[2]!.events.push(event);
    } else if (date >= endOfWeek && date < endOfNextWeek) {
      groups[3]!.events.push(event);
    } else if (date >= endOfNextWeek) {
      groups[4]!.events.push(event);
    }
  }

  const rows: EarningsDisplayRow[] = [];
  let eventIdx = 0;
  for (const group of groups) {
    if (group.events.length === 0) continue;
    rows.push({ kind: "separator", key: `sep-${group.label}`, label: `${group.label} (${group.events.length})` });
    for (const event of group.events) {
      rows.push({
        kind: "event",
        key: `event-${event.symbol}-${event.earningsDate.getTime()}-${eventIdx}`,
        event,
        eventIdx,
      });
      eventIdx++;
    }
  }
  return rows;
}
