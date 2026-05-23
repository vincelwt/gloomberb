import type { InlineTickerCatalogEntry } from "../../../../state/use-inline-tickers";
import type { ChatMessage, ChatUserSummary } from "../../../../utils/api-client";

export interface ChatMessageBaseProps {
  msg: ChatMessage;
  index: number;
  messages: ChatMessage[];
  selectedIdx: number;
  hoveredIdx: number | null;
  canSend: boolean;
  catalog: Record<string, InlineTickerCatalogEntry>;
  userByUsername: Map<string, ChatUserSummary>;
  openTicker: (symbol: string) => void;
  onUserHover: (user: ChatUserSummary) => void;
  onUserHoverEnd: () => void;
  beginReplyTo: (index: number, options?: { deferFocus?: boolean }) => void;
  jumpToMessage: (messageId: string) => void;
}
