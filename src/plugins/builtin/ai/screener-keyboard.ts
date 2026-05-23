import { useShortcut } from "../../../react/input";
import type { AiScreenerTab, RunState, ScreenerEditorState } from "./screener-model";

export function useAiScreenerKeyboard({
  activeTab,
  addTab,
  cancelRun,
  closeEditor,
  cycleEditorProvider,
  cycleTabs,
  editActiveTab,
  editorState,
  focused,
  isRunningActiveTab,
  removeTab,
  runTab,
  saveEditor,
}: {
  activeTab: AiScreenerTab | null;
  addTab: () => void;
  cancelRun: () => void;
  closeEditor: () => void;
  cycleEditorProvider: (direction: -1 | 1) => void;
  cycleTabs: (direction: -1 | 1) => void;
  editActiveTab: () => void;
  editorState: ScreenerEditorState | null;
  focused: boolean;
  isRunningActiveTab: boolean;
  removeTab: (tabId: string) => void;
  runTab: (tabId: string, mode: RunState["mode"]) => void;
  saveEditor: () => void;
}) {
  useShortcut((event) => {
    if (!focused) return;

    if (editorState) {
      if (event.name === "escape") {
        event.stopPropagation?.();
        event.preventDefault?.();
        closeEditor();
        return;
      }
      if (event.ctrl && event.name === "s") {
        event.stopPropagation?.();
        event.preventDefault?.();
        saveEditor();
        return;
      }
      if (event.ctrl && event.name === "p") {
        event.stopPropagation?.();
        event.preventDefault?.();
        cycleEditorProvider(event.shift ? -1 : 1);
        return;
      }
      return;
    }

    if (event.name === "t") {
      addTab();
      return;
    }
    if (event.name === "w" && activeTab) {
      removeTab(activeTab.id);
      return;
    }
    if (event.name === "[") {
      cycleTabs(-1);
      return;
    }
    if (event.name === "]") {
      cycleTabs(1);
      return;
    }
    if (event.name === "escape" && isRunningActiveTab) {
      cancelRun();
      return;
    }
    if (event.shift && event.name === "r" && activeTab && !isRunningActiveTab) {
      void runTab(activeTab.id, "force");
      return;
    }
    if (event.name === "r" && activeTab && !isRunningActiveTab) {
      void runTab(activeTab.id, "refresh");
      return;
    }
    if (event.name === "e") {
      editActiveTab();
    }
  }, { allowEditable: true });
}
