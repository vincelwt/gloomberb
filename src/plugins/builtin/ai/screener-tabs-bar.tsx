import { useRef } from "react";
import { Tabs } from "../../../components";
import { truncateWithEllipsis } from "../../../utils/text-wrap";
import type { AiScreenerTab, ScreenerEditorState } from "./screener-model";

export function AiScreenerTabsBar({
  activeTab,
  addTab,
  editTab,
  editorState,
  focused,
  removeTab,
  setActiveTabId,
  setCursorSymbol,
  tabs,
}: {
  activeTab: AiScreenerTab | null;
  addTab: () => void;
  editTab: (tab: AiScreenerTab | null) => void;
  editorState: ScreenerEditorState | null;
  focused: boolean;
  removeTab: (tabId: string) => void;
  setActiveTabId: (tabId: string | null) => void;
  setCursorSymbol: (symbol: string | null) => void;
  tabs: AiScreenerTab[];
}) {
  const lastTabClickRef = useRef<{ tabId: string; at: number } | null>(null);
  const displayTabs = editorState?.mode === "create"
    ? [...tabs.map((tab) => ({ id: tab.id, title: tab.title })), { id: "__draft__", title: "New Screener", draft: true }]
    : tabs.map((tab) => ({ id: tab.id, title: tab.title }));

  return (
    <Tabs
      tabs={displayTabs.map((tab) => {
        const isDraft = tab.draft === true;
        return {
          label: truncateWithEllipsis(tab.title, isDraft ? 20 : 18),
          value: tab.id,
          onClose: !editorState && !isDraft ? removeTab : undefined,
        };
      })}
      activeValue={editorState?.mode === "create" ? "__draft__" : activeTab?.id ?? null}
      onSelect={(tabId) => {
        if (editorState || tabId === "__draft__") return;
        const tab = tabs.find((entry) => entry.id === tabId);
        if (!tab) return;
        setActiveTabId(tab.id);
        setCursorSymbol(null);
        const now = Date.now();
        const last = lastTabClickRef.current;
        if (last?.tabId === tab.id && now - last.at <= 350) {
          lastTabClickRef.current = null;
          editTab(tab);
          return;
        }
        lastTabClickRef.current = { tabId: tab.id, at: now };
      }}
      compact
      variant="pill"
      closeMode="active"
      onAdd={editorState ? undefined : addTab}
      focused={focused && !editorState}
    />
  );
}
