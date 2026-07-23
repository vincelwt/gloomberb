import { useShortcut } from "../../../../react/input";
import type { AiScreenerTab, ScreenerEditorState } from "./model";

export function useAiScreenerKeyboard({
  activeTab,
  addTab,
  cancelRun,
  closeEditor,
  cycleEditorProvider,
  cycleTabs,
  editActiveTab,
  editorFocusTarget,
  editorState,
  focused,
  focusEditorModel,
  focusEditorPrompt,
  isRunningActiveTab,
  refreshActiveTab,
  removeTab,
  saveEditor,
}: {
  activeTab: AiScreenerTab | null;
  addTab: () => void;
  cancelRun: () => void;
  closeEditor: () => void;
  cycleEditorProvider: (direction: -1 | 1) => void;
  cycleTabs: (direction: -1 | 1) => void;
  editActiveTab: () => void;
  editorFocusTarget: "prompt" | "model";
  editorState: ScreenerEditorState | null;
  focused: boolean;
  focusEditorModel: () => void;
  focusEditorPrompt: () => void;
  isRunningActiveTab: boolean;
  refreshActiveTab: () => void;
  removeTab: (tabId: string) => void;
  saveEditor: () => void;
}) {
  useShortcut((event) => {
    if (!focused) return;

    if (editorState) {
      if (event.ctrl && event.name === "s") {
        event.stopPropagation?.();
        event.preventDefault?.();
        saveEditor();
        return;
      }
      if (editorFocusTarget === "model") {
        if (event.name === "escape" || event.name === "tab") {
          event.stopPropagation?.();
          event.preventDefault?.();
          focusEditorPrompt();
        }
        return;
      }
      if (event.name === "escape") {
        event.stopPropagation?.();
        event.preventDefault?.();
        closeEditor();
        return;
      }
      if (event.ctrl && event.name === "o") {
        event.stopPropagation?.();
        event.preventDefault?.();
        focusEditorModel();
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
    if (!event.shift && event.name === "r" && activeTab && !isRunningActiveTab) {
      refreshActiveTab();
      return;
    }
    if (event.name === "e") {
      editActiveTab();
    }
  }, { allowEditable: true });
}
