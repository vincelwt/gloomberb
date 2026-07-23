import { useCallback, useRef, useState } from "react";
import type { InputRenderable, TextareaRenderable } from "../../../../ui";
import type { AiProvider } from "../providers";
import { resolveDefaultAiProviderId } from "../providers";
import { modelIdAfterAiProviderChange, normalizeAiModelId } from "../runner-selection";
import {
  createScreenerTab,
  generateScreenerEditorKey,
  type AiScreenerTab,
  type ScreenerEditorState,
} from "./model";

export function useAiScreenerEditorRuntime({
  defaultModelId,
  defaultProviderId,
  providers,
  queueInitialRun,
  selectableProviders,
  setActiveTabId,
  setCursorSymbol,
  updateTabs,
  upsertTab,
}: {
  defaultModelId: string | null;
  defaultProviderId: string;
  providers: AiProvider[];
  queueInitialRun: (tabId: string) => void;
  selectableProviders: AiProvider[];
  setActiveTabId: (tabId: string | null) => void;
  setCursorSymbol: (symbol: string | null) => void;
  updateTabs: (updater: (tabs: AiScreenerTab[]) => AiScreenerTab[]) => void;
  upsertTab: (tabId: string, updater: (tab: AiScreenerTab) => AiScreenerTab) => void;
}) {
  const [editorState, setEditorState] = useState<ScreenerEditorState | null>(null);
  const [editorFocusTarget, setEditorFocusTarget] = useState<"prompt" | "model">("prompt");
  const editorModelInputRef = useRef<InputRenderable | null>(null);
  const editorTextareaRef = useRef<TextareaRenderable | null>(null);

  const focusEditorPrompt = useCallback(() => {
    setEditorFocusTarget("prompt");
    queueMicrotask(() => editorTextareaRef.current?.focus?.());
  }, []);

  const focusEditorModel = useCallback(() => {
    setEditorFocusTarget("model");
    queueMicrotask(() => editorModelInputRef.current?.focus?.());
  }, []);

  const openCreateEditor = useCallback(() => {
    setEditorFocusTarget("prompt");
    setEditorState({
      mode: "create",
      tabId: null,
      providerId: selectableProviders.some((provider) => provider.id === defaultProviderId)
        ? defaultProviderId
        : resolveDefaultAiProviderId(providers),
      modelId: defaultModelId ?? "",
      prompt: "",
      key: generateScreenerEditorKey(),
      error: null,
    });
  }, [defaultModelId, defaultProviderId, providers, selectableProviders]);

  const openEditEditor = useCallback((tab: AiScreenerTab | null) => {
    if (!tab) return;
    setEditorFocusTarget("prompt");
    setEditorState({
      mode: "edit",
      tabId: tab.id,
      providerId: tab.providerId,
      modelId: tab.modelId ?? "",
      prompt: tab.prompt,
      key: generateScreenerEditorKey(),
      error: null,
    });
  }, []);

  const closeEditor = useCallback(() => {
    editorModelInputRef.current = null;
    editorTextareaRef.current = null;
    setEditorFocusTarget("prompt");
    setEditorState(null);
  }, []);

  const selectEditorProvider = useCallback((providerId: string) => {
    setEditorState((current) => {
      if (!current || current.providerId === providerId) return current;
      return {
        ...current,
        providerId,
        modelId: modelIdAfterAiProviderChange(providerId, defaultProviderId, defaultModelId),
        error: null,
      };
    });
  }, [defaultModelId, defaultProviderId]);

  const cycleEditorProvider = useCallback((direction: -1 | 1) => {
    setEditorState((current) => {
      if (!current || selectableProviders.length === 0) return current;
      const currentIndex = Math.max(0, selectableProviders.findIndex((provider) => provider.id === current.providerId));
      const nextIndex = (currentIndex + direction + selectableProviders.length) % selectableProviders.length;
      return {
        ...current,
        providerId: selectableProviders[nextIndex]!.id,
        modelId: modelIdAfterAiProviderChange(
          selectableProviders[nextIndex]!.id,
          defaultProviderId,
          defaultModelId,
        ),
        error: null,
      };
    });
  }, [defaultModelId, defaultProviderId, selectableProviders]);

  const saveEditor = useCallback(() => {
    if (!editorState) return;
    const prompt = editorTextareaRef.current?.editBuffer.getText().trim() || editorState.prompt.trim();
    if (!prompt) {
      setEditorState((current) => current ? { ...current, error: "Prompt is required." } : current);
      return;
    }

    if (editorState.mode === "create") {
      const tab = createScreenerTab(prompt, editorState.providerId, normalizeAiModelId(editorState.modelId));
      queueInitialRun(tab.id);
      updateTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
      setCursorSymbol(null);
    } else if (editorState.tabId) {
      upsertTab(editorState.tabId, (current) => ({
        ...current,
        prompt,
        providerId: editorState.providerId,
        modelId: normalizeAiModelId(editorState.modelId),
        lastError: null,
      }));
    }

    editorTextareaRef.current = null;
    editorModelInputRef.current = null;
    setEditorFocusTarget("prompt");
    setEditorState(null);
  }, [editorState, queueInitialRun, setActiveTabId, setCursorSymbol, updateTabs, upsertTab]);

  return {
    closeEditor,
    cycleEditorProvider,
    editorFocusTarget,
    editorModelInputRef,
    editorState,
    editorTextareaRef,
    focusEditorModel,
    focusEditorPrompt,
    openCreateEditor,
    openEditEditor,
    saveEditor,
    selectEditorProvider,
    setEditorState,
  };
}
