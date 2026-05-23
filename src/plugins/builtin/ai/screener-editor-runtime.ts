import { useCallback, useRef, useState } from "react";
import type { TextareaRenderable } from "../../../ui";
import type { AiProvider } from "./providers";
import { resolveDefaultAiProviderId } from "./providers";
import {
  createScreenerTab,
  generateScreenerEditorKey,
  type AiScreenerTab,
  type ScreenerEditorState,
} from "./screener-model";

export function useAiScreenerEditorRuntime({
  providers,
  queueInitialRun,
  selectableProviders,
  setActiveTabId,
  setCursorSymbol,
  updateTabs,
  upsertTab,
}: {
  providers: AiProvider[];
  queueInitialRun: (tabId: string) => void;
  selectableProviders: AiProvider[];
  setActiveTabId: (tabId: string | null) => void;
  setCursorSymbol: (symbol: string | null) => void;
  updateTabs: (updater: (tabs: AiScreenerTab[]) => AiScreenerTab[]) => void;
  upsertTab: (tabId: string, updater: (tab: AiScreenerTab) => AiScreenerTab) => void;
}) {
  const [editorState, setEditorState] = useState<ScreenerEditorState | null>(null);
  const editorTextareaRef = useRef<TextareaRenderable | null>(null);

  const openCreateEditor = useCallback(() => {
    setEditorState({
      mode: "create",
      tabId: null,
      providerId: resolveDefaultAiProviderId(providers),
      prompt: "",
      key: generateScreenerEditorKey(),
      error: null,
    });
  }, [providers]);

  const openEditEditor = useCallback((tab: AiScreenerTab | null) => {
    if (!tab) return;
    setEditorState({
      mode: "edit",
      tabId: tab.id,
      providerId: tab.providerId,
      prompt: tab.prompt,
      key: generateScreenerEditorKey(),
      error: null,
    });
  }, []);

  const closeEditor = useCallback(() => {
    editorTextareaRef.current = null;
    setEditorState(null);
  }, []);

  const cycleEditorProvider = useCallback((direction: -1 | 1) => {
    setEditorState((current) => {
      if (!current || selectableProviders.length === 0) return current;
      const currentIndex = Math.max(0, selectableProviders.findIndex((provider) => provider.id === current.providerId));
      const nextIndex = (currentIndex + direction + selectableProviders.length) % selectableProviders.length;
      return {
        ...current,
        providerId: selectableProviders[nextIndex]!.id,
        error: null,
      };
    });
  }, [selectableProviders]);

  const saveEditor = useCallback(() => {
    if (!editorState) return;
    const prompt = editorTextareaRef.current?.editBuffer.getText().trim() || editorState.prompt.trim();
    if (!prompt) {
      setEditorState((current) => current ? { ...current, error: "Prompt is required." } : current);
      return;
    }

    if (editorState.mode === "create") {
      const tab = createScreenerTab(prompt, editorState.providerId);
      queueInitialRun(tab.id);
      updateTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
      setCursorSymbol(null);
    } else if (editorState.tabId) {
      upsertTab(editorState.tabId, (current) => ({
        ...current,
        prompt,
        providerId: editorState.providerId,
        lastError: null,
      }));
    }

    editorTextareaRef.current = null;
    setEditorState(null);
  }, [editorState, queueInitialRun, setActiveTabId, setCursorSymbol, updateTabs, upsertTab]);

  return {
    closeEditor,
    cycleEditorProvider,
    editorState,
    editorTextareaRef,
    openCreateEditor,
    openEditEditor,
    saveEditor,
    setEditorState,
  };
}
