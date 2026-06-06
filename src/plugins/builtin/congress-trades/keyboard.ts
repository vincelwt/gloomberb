import { useCallback } from "react";
import { type DataTableKeyEvent } from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { CongressTab, DetailMode } from "./model";

export function useCongressTradesKeyboard({
  activeTab,
  detailMode,
  focused,
  load,
  openSelectedTicker,
  openSelectedTradeMember,
  openSelectedTradeSource,
  selectTab,
}: {
  activeTab: CongressTab;
  detailMode: DetailMode;
  focused: boolean;
  load: (refresh?: boolean) => void;
  openSelectedTicker: () => void;
  openSelectedTradeMember: () => void;
  openSelectedTradeSource: () => void;
  selectTab: (tab: string) => void;
}) {
  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (detailMode?.kind === "member") {
      return false;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTradeSource();
      return true;
    }
    if (isPlainKey(event, "t")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTicker();
      return true;
    }
    if (isPlainKey(event, "m")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTradeMember();
      return true;
    }
    return false;
  }, [detailMode?.kind, openSelectedTicker, openSelectedTradeMember, openSelectedTradeSource]);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(true);
      return true;
    }
    if (activeTab === "trades" && isPlainKey(event, "t")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTicker();
      return true;
    }
    if (activeTab === "trades" && isPlainKey(event, "m")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTradeMember();
      return true;
    }
    if (activeTab === "trades" && isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTradeSource();
      return true;
    }
    return false;
  }, [activeTab, load, openSelectedTicker, openSelectedTradeMember, openSelectedTradeSource]);

  useShortcut((event) => {
    if (!focused || detailMode || event.targetEditable) return;
    if (event.name === "1") {
      event.preventDefault?.();
      event.stopPropagation?.();
      selectTab("trades");
    } else if (event.name === "2") {
      event.preventDefault?.();
      event.stopPropagation?.();
      selectTab("members");
    }
  });

  return { handleDetailKeyDown, handleRootKeyDown };
}
