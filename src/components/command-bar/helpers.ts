import type {
  CommandDef,
  PaneSettingField,
  PaneTemplateDef,
  WizardStep,
} from "../../types/plugin";
import type {
  CommandBarFieldOption,
  CommandBarFieldValue,
  CommandBarRoute,
  CommandBarWorkflowField,
} from "./workflow-types";
import type { CollectionKind, CollectionMembershipAction } from "./workflow-ops";

export type RouteCommandId = "search-ticker" | "theme" | "plugins" | "layout" | "new-pane";
export type CollectionCommandId = "add-watchlist" | "add-portfolio" | "remove-watchlist" | "remove-portfolio";

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

export function isRouteCommandId(commandId: string): commandId is RouteCommandId {
  return commandId === "search-ticker"
    || commandId === "theme"
    || commandId === "plugins"
    || commandId === "layout"
    || commandId === "new-pane";
}

export function normalizeFieldOptions(
  options: Array<{ label: string; value: string; description?: string }> | undefined,
): CommandBarFieldOption[] {
  return (options ?? []).map((option) => ({
    label: option.label,
    value: option.value,
    description: option.description,
  }));
}

export function getVisibleWorkflowFields(
  fields: CommandBarWorkflowField[],
  values: Record<string, CommandBarFieldValue>,
): CommandBarWorkflowField[] {
  return fields.filter((field) => {
    if (!field.dependsOn || field.dependsOn.length === 0) return true;
    return field.dependsOn.every((dependency) => String(values[dependency.key] ?? "") === dependency.value);
  });
}

export function coerceFieldString(value: CommandBarFieldValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export function coerceFieldBoolean(value: CommandBarFieldValue | undefined): boolean {
  return value === true;
}

export function coerceFieldValues(value: CommandBarFieldValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function fieldOptionLabel(field: CommandBarWorkflowField, value: string): string {
  if (field.type !== "select" && field.type !== "multi-select" && field.type !== "ordered-multi-select") {
    return value;
  }
  return field.options.find((option) => option.value === value)?.label ?? value;
}

export function summarizeWorkflowFieldValue(
  field: CommandBarWorkflowField,
  value: CommandBarFieldValue | undefined,
): string {
  switch (field.type) {
    case "toggle":
      return coerceFieldBoolean(value) ? "On" : "Off";
    case "text":
    case "password":
    case "number": {
      const next = coerceFieldString(value).trim();
      return next.length > 0 ? next : "Unset";
    }
    case "select": {
      const selected = coerceFieldString(value);
      return selected ? fieldOptionLabel(field, selected) : "Choose…";
    }
    case "multi-select":
    case "ordered-multi-select": {
      const selected = coerceFieldValues(value);
      if (selected.length === 0) return "None";
      const labels = selected.map((entry) => fieldOptionLabel(field, entry)).slice(0, 3);
      const suffix = selected.length > 3 ? ` +${selected.length - 3}` : "";
      return `${labels.join(", ")}${suffix}`;
    }
    default:
      return "";
  }
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

export function toggleSelectedValue(currentValues: string[], value: string): string[] {
  return currentValues.includes(value)
    ? currentValues.filter((entry) => entry !== value)
    : [...currentValues, value];
}

export function moveSelectedValue(
  field: { options: CommandBarFieldOption[] },
  currentValues: string[],
  selectedOption: string,
  direction: "up" | "down",
): string[] {
  if (!currentValues.includes(selectedOption)) return currentValues;

  const optionValueSet = new Set(field.options.map((option) => option.value));
  const ordered = currentValues.filter((value) => optionValueSet.has(value));
  const index = ordered.indexOf(selectedOption);
  if (index < 0) return currentValues;

  const targetIndex = direction === "up"
    ? Math.max(0, index - 1)
    : Math.min(ordered.length - 1, index + 1);
  if (targetIndex === index) return currentValues;

  const next = [...ordered];
  const [entry] = next.splice(index, 1);
  next.splice(targetIndex, 0, entry!);
  const unknownValues = currentValues.filter((value) => !optionValueSet.has(value));
  return [...next, ...unknownValues];
}

export function normalizeWizardFields(steps: WizardStep[]): {
  fields: CommandBarWorkflowField[];
  description: string[];
  initialValues: Record<string, CommandBarFieldValue>;
  pendingLabel?: string;
  successLabel?: string;
} {
  const fields: CommandBarWorkflowField[] = [];
  const description: string[] = [];
  const initialValues: Record<string, CommandBarFieldValue> = {};
  let pendingLabel: string | undefined;
  let successLabel: string | undefined;

  for (const step of steps) {
    if (step.type === "info") {
      if (step.key.startsWith("_validate")) {
        pendingLabel = step.body?.[0] || step.label;
        successLabel = step.body?.[1];
      } else if (step.body) {
        description.push(...step.body);
      }
      continue;
    }

    const type = step.type === "password"
      ? "password"
      : step.type === "number"
        ? "number"
        : step.type === "select"
          ? "select"
          : "text";
    if (type === "select") {
      fields.push({
        id: step.key,
        label: step.label,
        type,
        options: normalizeFieldOptions(step.options),
        placeholder: step.placeholder,
        description: step.body?.[0],
        required: true,
        dependsOn: step.dependsOn ? [{ key: step.dependsOn.key, value: step.dependsOn.value }] : undefined,
      });
      if (step.defaultValue) {
        initialValues[step.key] = step.defaultValue;
      } else if (step.options?.[0]?.value) {
        initialValues[step.key] = step.options[0].value;
      }
      continue;
    }

    fields.push({
      id: step.key,
      label: step.label,
      type,
      placeholder: step.placeholder,
      description: step.body?.[0],
      required: true,
      dependsOn: step.dependsOn ? [{ key: step.dependsOn.key, value: step.dependsOn.value }] : undefined,
    });
    if (step.defaultValue) {
      initialValues[step.key] = step.defaultValue;
    }
  }

  return { fields, description, initialValues, pendingLabel, successLabel };
}

export function routeCommandIdToScreen(commandId: RouteCommandId): "ticker-search" | "themes" | "plugins" | "layout" | "new-pane" {
  switch (commandId) {
    case "search-ticker":
      return "ticker-search";
    case "theme":
      return "themes";
    case "plugins":
      return "plugins";
    case "layout":
      return "layout";
    case "new-pane":
      return "new-pane";
  }
}

export function slugifyName(name: string, fallbackPrefix: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `${fallbackPrefix}-${Date.now()}`;
}

export function getFirstVisibleFieldId(
  fields: CommandBarWorkflowField[],
  values: Record<string, CommandBarFieldValue>,
): string | null {
  return getVisibleWorkflowFields(fields, values)[0]?.id ?? null;
}

export function isWorkflowTextField(field: CommandBarWorkflowField | undefined): boolean {
  return field?.type === "text" || field?.type === "password" || field?.type === "number";
}

export function buildGeneratedTemplateField(
  template: PaneTemplateDef,
  activeTicker: string | null,
): {
  field: CommandBarWorkflowField | null;
  initialValue: CommandBarFieldValue | undefined;
} {
  const placeholder = template.shortcut?.argPlaceholder;
  if (placeholder === "ticker") {
    return {
      field: {
        id: "ticker",
        label: "Ticker",
        type: "text",
        required: true,
        placeholder: activeTicker || "MSFT",
      },
      initialValue: activeTicker ?? "",
    };
  }
  if (placeholder === "tickers") {
    return {
      field: {
        id: "tickers",
        label: "Tickers",
        type: "text",
        required: true,
        placeholder: "AAPL, MSFT, NVDA",
      },
      initialValue: "",
    };
  }
  return { field: null, initialValue: undefined };
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
  return route ? "esc back" : "esc close";
}

export function isRootParsedCommand(commandId: string): boolean {
  return commandId === "search-ticker"
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
