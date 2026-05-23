import { usePaneFooter, type PaneFooterSegment } from "../../../components";
import {
  countLoadingQuotes,
  latestQuoteTimestamp,
  type QuoteMap,
} from "./model";

export function useWorldIndicesFooter(quotes: QuoteMap) {
  const loadingCount = countLoadingQuotes(quotes);
  const latestQuoteTs = latestQuoteTimestamp(quotes);

  usePaneFooter("world-indices", () => {
    const info: PaneFooterSegment[] = [];
    if (loadingCount > 0) {
      info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    }
    if (latestQuoteTs > 0) {
      info.push({
        id: "fresh",
        parts: [{
          text: new Date(latestQuoteTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          tone: "muted",
        }],
      });
    }
    return { info };
  }, [latestQuoteTs, loadingCount]);
}
