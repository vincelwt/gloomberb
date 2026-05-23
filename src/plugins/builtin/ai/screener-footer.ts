import { usePaneFooter } from "../../../components";
import { formatTimeAgo } from "../../../utils/format";
import { getAiProvider, type AiProvider } from "./providers";
import type { AiScreenerTab, RunState, ScreenerEditorState } from "./screener-model";

interface UseAiScreenerFooterOptions {
  activeTab: AiScreenerTab | null;
  addTab: () => void;
  cycleEditorProvider: (direction: -1 | 1) => void;
  editActiveTab: () => void;
  editorProvider: AiProvider | null;
  editorState: ScreenerEditorState | null;
  forceRefreshActiveTab: () => void;
  forceRunArmed: boolean;
  isRunningActiveTab: boolean;
  providers: AiProvider[];
  refreshActiveTab: () => void;
  removeTab: (tabId: string) => void;
  runState: RunState | null;
  saveEditor: () => void;
  selectableProviders: AiProvider[];
}

export function useAiScreenerFooter({
  activeTab,
  addTab,
  cycleEditorProvider,
  editActiveTab,
  editorProvider,
  editorState,
  forceRefreshActiveTab,
  forceRunArmed,
  isRunningActiveTab,
  providers,
  refreshActiveTab,
  removeTab,
  runState,
  saveEditor,
  selectableProviders,
}: UseAiScreenerFooterOptions) {
  const activeProvider = activeTab ? getAiProvider(activeTab.providerId, providers) : null;
  const statusText = activeTab
    ? isRunningActiveTab && runState
      ? `${runState.mode === "force" ? "Force refreshing" : "Refreshing"} with ${activeProvider?.name ?? "AI"}...`
      : activeTab.lastSuccessAt
        ? `Last ran ${formatTimeAgo(new Date(activeTab.lastSuccessAt))}`
        : "Never run"
    : "No screener selected";

  usePaneFooter("ai-screener", () => ({
    info: [
      ...(editorState ? [{
        id: "provider",
        parts: [{ text: editorProvider?.name ?? editorState.providerId, tone: editorProvider?.available === false ? "warning" as const : "value" as const, bold: true }],
      }] : activeTab ? [{
        id: "provider",
        parts: [{ text: activeProvider?.name ?? activeTab.providerId, tone: activeProvider?.available === false ? "warning" as const : "value" as const, bold: true }],
      }] : []),
      { id: "status", parts: [{ text: statusText, tone: isRunningActiveTab ? "muted" : "value" }] },
      ...(forceRunArmed ? [{ id: "force", parts: [{ text: "force refresh armed", tone: "warning" as const }] }] : []),
    ],
    hints: editorState
      ? [
          { id: "save", key: "Ctrl+S", label: "save", onPress: saveEditor },
          { id: "provider", key: "Ctrl+P", label: "provider", onPress: () => cycleEditorProvider(1), disabled: selectableProviders.length <= 1 },
        ]
      : [
          { id: "new", key: "t", label: "new", onPress: addTab },
          { id: "close", key: "w", label: "close tab", onPress: activeTab ? () => removeTab(activeTab.id) : undefined, disabled: !activeTab },
          { id: "refresh", key: "r", label: "efresh", onPress: refreshActiveTab, disabled: !activeTab || isRunningActiveTab },
          { id: "force-refresh", key: "Shift+R", label: "force refresh", onPress: forceRefreshActiveTab, disabled: !activeTab || isRunningActiveTab },
          { id: "edit", key: "e", label: "dit", onPress: editActiveTab, disabled: !activeTab },
        ],
  }), [
    activeProvider?.available,
    activeProvider?.name,
    activeTab,
    addTab,
    cycleEditorProvider,
    editActiveTab,
    editorProvider?.available,
    editorProvider?.name,
    editorState,
    forceRefreshActiveTab,
    forceRunArmed,
    isRunningActiveTab,
    refreshActiveTab,
    removeTab,
    saveEditor,
    selectableProviders.length,
    statusText,
  ]);
}
