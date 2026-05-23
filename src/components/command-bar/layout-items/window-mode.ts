import type { PluginRegistry, WindowEditMode } from "../../../plugins/registry";
import { fuzzyFilter } from "../../../utils/fuzzy-search";
import type { ResultItem } from "../list-model";
import type { CloseAll } from "./types";

export const WINDOW_MODE_COMMAND_OPTIONS: Array<{
  mode: WindowEditMode;
  label: string;
  detail: string;
  query: string;
  searchText: string;
}> = [
  {
    mode: "move",
    label: "Move Window",
    detail: "Enter window edit mode with Tab cycling windows",
    query: "WIN move",
    searchText: "window mode move reposition",
  },
  {
    mode: "resize",
    label: "Resize Window",
    detail: "Enter window edit mode with Tab cycling resize handles",
    query: "WIN resize",
    searchText: "window mode resize size corner divider",
  },
];

export function parseWindowModeCommandArg(arg: string): WindowEditMode | null {
  const normalized = arg.trim().toLowerCase();
  if (!normalized) return null;
  if ("move".startsWith(normalized) || normalized === "m") return "move";
  if ("resize".startsWith(normalized) || normalized === "r") return "resize";
  return null;
}

export function buildWindowModeResultItems({
  arg,
  closeAll,
  focusedPaneId,
  pluginRegistry,
}: {
  arg: string;
  closeAll: CloseAll;
  focusedPaneId: string | null;
  pluginRegistry: PluginRegistry;
}): ResultItem[] {
  const normalized = arg.trim().toLowerCase();
  const exactMode = parseWindowModeCommandArg(arg);
  const options = normalized
    ? WINDOW_MODE_COMMAND_OPTIONS.filter((option) => (
      option.mode === exactMode
      || option.mode.startsWith(normalized)
      || fuzzyFilter([option], normalized, (item) => `${item.label} ${item.detail} ${item.searchText}`).length > 0
    ))
    : WINDOW_MODE_COMMAND_OPTIONS;

  const visibleOptions = options.length > 0 ? options : WINDOW_MODE_COMMAND_OPTIONS;
  return visibleOptions.map((option) => ({
    id: `window-mode:${option.mode}`,
    label: option.label,
    detail: option.detail,
    category: "Config",
    kind: "action" as const,
    right: option.query,
    shortcutQuery: option.query,
    action: () => {
      closeAll({ revertThemePreview: false });
      pluginRegistry.openWindowMode(focusedPaneId ?? undefined, option.mode);
    },
  }));
}
