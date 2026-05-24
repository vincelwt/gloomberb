import type { CommandDef, PaneSettingField } from "../../types/plugin";
import type { CommandBarRoute } from "./workflow/types";
import type { CollectionKind, CollectionMembershipAction } from "./workflow/ops";

export { slugifyName } from "../../utils/slugify";
export {
  buildGeneratedTemplateField,
  coerceFieldBoolean,
  coerceFieldString,
  coerceFieldValues,
  getFirstVisibleFieldId,
  getWorkflowFieldDescription,
  getVisibleWorkflowFields,
  isWorkflowTextField,
  normalizeFieldOptions,
  normalizeWizardFields,
  summarizeWorkflowFieldValue,
} from "./workflow/fields";

export type RouteCommandId = "security-description" | "plugins" | "layout";
export type CollectionCommandId = "add-watchlist" | "add-portfolio" | "remove-watchlist" | "remove-portfolio";

export function isRouteCommandId(commandId: string): commandId is RouteCommandId {
  return commandId === "security-description"
    || commandId === "plugins"
    || commandId === "layout";
}

export function routeCommandIdToScreen(commandId: RouteCommandId): "ticker-search" | "plugins" | "layout" {
  switch (commandId) {
    case "security-description":
      return "ticker-search";
    case "plugins":
      return "plugins";
    case "layout":
      return "layout";
  }
}

export function isRootParsedCommand(commandId: string): boolean {
  return commandId === "security-description"
    || commandId === "add-watchlist"
    || commandId === "add-portfolio"
    || commandId === "remove-watchlist"
    || commandId === "remove-portfolio";
}

export function isCollectionCommand(commandId: string): commandId is CollectionCommandId {
  return commandId === "add-watchlist"
    || commandId === "add-portfolio"
    || commandId === "remove-watchlist"
    || commandId === "remove-portfolio";
}

export function getCollectionCommandKind(commandId: CollectionCommandId): CollectionKind {
  return commandId === "add-watchlist" || commandId === "remove-watchlist" ? "watchlist" : "portfolio";
}

export function getCollectionCommandAction(commandId: CollectionCommandId): CollectionMembershipAction {
  return commandId === "add-watchlist" || commandId === "add-portfolio" ? "add" : "remove";
}

export function getCollectionCommandVerb(action: CollectionMembershipAction): string {
  return action === "add" ? "Add" : "Remove";
}

export function summarizePaneSettingValue(field: PaneSettingField, value: unknown): string {
  switch (field.type) {
    case "toggle":
      return value === true ? "On" : "Off";
    case "text":
      return typeof value === "string" && value.trim().length > 0 ? value : "Unset";
    case "select": {
      const option = field.options.find((entry) => entry.value === value);
      return option?.label ?? "Unset";
    }
    case "multi-select":
    case "ordered-multi-select": {
      const selected = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
      if (selected.length === 0) return "None";
      const labels = selected
        .map((entry) => field.options.find((option) => option.value === entry)?.label ?? entry)
        .slice(0, 3);
      const suffix = selected.length > 3 ? ` +${selected.length - 3}` : "";
      return `${labels.join(", ")}${suffix}`;
    }
    default:
      return "";
  }
}

export function getScreenFooterLeft(route: CommandBarRoute | null): string {
  if (!route) return "up/down move  enter select";
  switch (route.kind) {
    case "mode":
      if (route.screen === "plugins") return "up/down move  enter select  space toggle";
      return "up/down move  enter select";
    case "picker":
      if (route.pickerId === "field-multi-select") {
        const ordered = route.payload?.fieldType === "ordered-multi-select";
        return ordered ? "up/down move  space toggle  [ ] reorder  enter done" : "up/down move  space toggle  enter done";
      }
      return "up/down move  enter select";
    case "pane-settings":
      return "up/down move  enter edit";
    case "workflow":
      return "tab move  enter act";
    case "confirm":
      return "enter confirm  esc cancel";
    default:
      return "up/down move  enter select";
  }
}

export function getScreenFooterRight(route: CommandBarRoute | null): string {
  if (!route) return "esc cancel";

  if (route.kind === "workflow") return "backspace/esc back";
  if (route.kind === "confirm") return "backspace/esc back";

  if (
    (route.kind === "mode" || route.kind === "picker" || route.kind === "pane-settings")
    && route.query.trim().length > 0
  ) {
    return "backspace delete  esc back";
  }

  return "backspace/esc back";
}

export function summarizeError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || "",
    };
  }
  return { message: String(error) };
}

export function looksDestructiveCommand(
  command: Pick<CommandDef, "id" | "label" | "description" | "keywords">,
): boolean {
  const haystack = [
    command.id,
    command.label,
    command.description || "",
    ...(command.keywords || []),
  ].join(" ").toLowerCase();
  return /\b(delete|remove|disconnect|reset|close)\b/.test(haystack);
}
