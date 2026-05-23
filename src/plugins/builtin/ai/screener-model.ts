import { deriveScreenerTitle, type ValidatedScreenerResult } from "./screener-contract";

export interface AiScreenerTab {
  id: string;
  title: string;
  prompt: string;
  providerId: string;
  createdAt: number;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastRunPromptSignature: string | null;
  lastError: string | null;
  lastWarning: string | null;
  summary: string | null;
  debugOutput: string | null;
  results: ValidatedScreenerResult[];
}

export interface PersistedAiScreenerPaneState {
  tabs: AiScreenerTab[];
}

export interface ScreenerSortPreference {
  columnId: string | null;
  direction: "asc" | "desc";
}

export interface RunState {
  tabId: string;
  mode: "refresh" | "force";
  output: string;
}

export interface ScreenerEditorState {
  mode: "create" | "edit";
  tabId: string | null;
  providerId: string;
  prompt: string;
  key: string;
  error: string | null;
}

export const EMPTY_PANE_STATE: PersistedAiScreenerPaneState = { tabs: [] };
export const EMPTY_SORT: ScreenerSortPreference = { columnId: null, direction: "asc" };

let nextScreenerTabId = 1;
let nextScreenerEditorId = 1;

function generateScreenerTabId(): string {
  return `${Date.now()}-${nextScreenerTabId++}`;
}

export function generateScreenerEditorKey(): string {
  return `editor-${Date.now()}-${nextScreenerEditorId++}`;
}

export function createScreenerTab(prompt: string, providerId: string): AiScreenerTab {
  return {
    id: generateScreenerTabId(),
    title: deriveScreenerTitle(prompt),
    prompt,
    providerId,
    createdAt: Date.now(),
    lastRunAt: null,
    lastSuccessAt: null,
    lastRunPromptSignature: null,
    lastError: null,
    lastWarning: null,
    summary: null,
    debugOutput: null,
    results: [],
  };
}

export function normalizeTabs(value: unknown): AiScreenerTab[] {
  if (!Array.isArray((value as PersistedAiScreenerPaneState | undefined)?.tabs)) return [];
  return (value as PersistedAiScreenerPaneState).tabs
    .filter((entry): entry is AiScreenerTab => !!entry && typeof entry === "object" && typeof (entry as AiScreenerTab).id === "string")
    .map((entry) => ({
      ...entry,
      title: typeof entry.title === "string" ? entry.title : "New Screener",
      prompt: typeof entry.prompt === "string" ? entry.prompt : "",
      providerId: typeof entry.providerId === "string" ? entry.providerId : "claude",
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
      lastRunAt: typeof entry.lastRunAt === "number" ? entry.lastRunAt : null,
      lastSuccessAt: typeof entry.lastSuccessAt === "number" ? entry.lastSuccessAt : null,
      lastRunPromptSignature: typeof entry.lastRunPromptSignature === "string" ? entry.lastRunPromptSignature : null,
      lastError: typeof entry.lastError === "string" ? entry.lastError : null,
      lastWarning: typeof entry.lastWarning === "string" ? entry.lastWarning : null,
      summary: typeof entry.summary === "string" ? entry.summary : null,
      debugOutput: typeof entry.debugOutput === "string" ? entry.debugOutput : null,
      results: Array.isArray(entry.results)
        ? entry.results.filter((result): result is ValidatedScreenerResult =>
          !!result
          && typeof result === "object"
          && typeof result.symbol === "string"
          && typeof result.exchange === "string"
          && typeof result.reason === "string"
          && typeof result.resolvedName === "string",
        )
        : [],
    }));
}

export function getResultMap(tab: AiScreenerTab | null): Map<string, ValidatedScreenerResult> {
  return new Map((tab?.results ?? []).map((result) => [result.symbol, result]));
}
