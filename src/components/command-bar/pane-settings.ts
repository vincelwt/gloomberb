import type { PaneSettingField } from "../../types/plugin";
import type { PluginRegistry } from "../../plugins/registry";
import { fuzzyFilter } from "../../utils/fuzzy-search";
import type { ResultItem } from "./list-model";
import type { CommandBarRoute, CommandBarWorkflowRoute } from "./workflow/workflow-types";
import { summarizePaneSettingValue } from "./helpers";

type NotifyFn = (body: string, options?: { type?: "info" | "success" | "error" }) => void;

type NormalizedPaneSettingField =
  | { mode: "toggle"; value: boolean }
  | { mode: "workflow"; route: CommandBarWorkflowRoute | null }
  | { mode: "picker"; route: Extract<CommandBarRoute, { kind: "picker" }> };

function normalizePaneSettingField(
  paneId: string,
  field: PaneSettingField,
  currentValue: unknown,
): NormalizedPaneSettingField {
  switch (field.type) {
    case "toggle":
      return {
        mode: "toggle",
        value: currentValue === true,
      };
    case "text":
      return {
        mode: "workflow",
        route: {
          kind: "workflow",
          workflowId: `pane-setting:${paneId}:${field.key}`,
          title: field.label,
          subtitle: field.description,
          fields: [{
            id: field.key,
            label: field.label,
            type: "text",
            placeholder: field.placeholder,
            required: false,
            description: field.description,
          }],
          values: {
            [field.key]: typeof currentValue === "string" ? currentValue : "",
          },
          activeFieldId: field.key,
          submitLabel: "Apply",
          cancelLabel: "Back",
          pendingLabel: "Applying setting…",
          pending: false,
          error: null,
          successBehavior: "back",
          payload: {
            kind: "pane-setting",
            actionId: field.key,
          },
          payloadMeta: {
            paneId,
            field,
          },
        },
      };
    case "select":
      return {
        mode: "picker",
        route: {
          kind: "picker",
          pickerId: "field-select",
          title: field.label,
          query: "",
          selectedIdx: Math.max(0, field.options.findIndex((option) => option.value === currentValue)),
          hoveredIdx: null,
          options: field.options.map((option) => ({
            id: option.value,
            label: option.label,
            detail: option.description,
            description: option.description,
          })),
          payload: {
            parentKind: "pane-settings",
            paneId,
            field,
            fieldType: field.type,
          },
        },
      };
    case "multi-select":
    case "ordered-multi-select":
      return {
        mode: "picker",
        route: {
          kind: "picker",
          pickerId: "field-multi-select",
          title: field.label,
          query: "",
          selectedIdx: 0,
          hoveredIdx: null,
          options: field.options.map((option) => ({
            id: option.value,
            label: option.label,
            detail: option.description,
            description: option.description,
          })),
          payload: {
            parentKind: "pane-settings",
            paneId,
            field,
            fieldType: field.type,
            selectedValues: Array.isArray(currentValue)
              ? currentValue.filter((entry): entry is string => typeof entry === "string")
              : [],
          },
        },
      };
    default:
      return {
        mode: "workflow",
        route: null,
      };
  }
}

export function activatePaneSettingFieldAction(options: {
  paneId: string;
  field: PaneSettingField;
  currentValue: unknown;
  keepRouteOpen?: boolean;
  closeAll: (options?: { revertThemePreview?: boolean }) => void;
  notify: NotifyFn;
  openWorkflowRoute: (route: CommandBarWorkflowRoute) => void;
  pluginRegistry: PluginRegistry;
  pushRoute: (route: CommandBarRoute) => void;
  updateTopRoute: (updater: (route: CommandBarRoute) => CommandBarRoute) => void;
}): void {
  const {
    closeAll,
    currentValue,
    field,
    keepRouteOpen,
    notify,
    openWorkflowRoute,
    paneId,
    pluginRegistry,
    pushRoute,
    updateTopRoute,
  } = options;
  const normalized = normalizePaneSettingField(paneId, field, currentValue);
  if (normalized.mode === "toggle") {
    if (keepRouteOpen) {
      updateTopRoute((route) => route.kind === "pane-settings"
        ? { ...route, pendingFieldKey: field.key, error: null }
        : route);
    }
    void pluginRegistry.applyPaneSettingValueFn(paneId, field, !normalized.value)
      .then(() => {
        if (keepRouteOpen) {
          updateTopRoute((route) => route.kind === "pane-settings"
            ? { ...route, pendingFieldKey: null, error: null }
            : route);
        } else {
          closeAll({ revertThemePreview: false });
        }
      })
      .catch((error) => {
        if (keepRouteOpen) {
          updateTopRoute((route) => route.kind === "pane-settings"
            ? {
              ...route,
              pendingFieldKey: null,
              error: error instanceof Error ? error.message : "Could not apply that setting.",
            }
            : route);
          return;
        }
        notify(error instanceof Error ? error.message : "Could not apply that setting.", { type: "error" });
      });
    return;
  }
  if (normalized.mode === "workflow" && normalized.route) {
    openWorkflowRoute(normalized.route);
    return;
  }
  if (normalized.mode === "picker") {
    pushRoute(normalized.route);
  }
}

export function buildPaneSettingResultItems(options: {
  paneId: string | null;
  query: string;
  pluginRegistry: PluginRegistry;
  keepRouteOpen?: boolean;
  activatePaneSettingField: (
    paneId: string,
    field: PaneSettingField,
    currentValue: unknown,
    options?: { keepRouteOpen?: boolean },
  ) => void;
}): ResultItem[] {
  if (!options.paneId) return [];
  const descriptor = options.pluginRegistry.resolvePaneSettings(options.paneId);
  if (!descriptor) return [];

  const category = descriptor.settingsDef.title || "Pane Settings";
  const paneLabel = descriptor.pane.title || descriptor.paneDef.name || descriptor.pane.paneId;
  const items = descriptor.settingsDef.fields.map((field): ResultItem => {
    const currentValue = descriptor.context.settings[field.key];
    return {
      id: `pane-setting:${field.key}`,
      label: field.label,
      detail: summarizePaneSettingValue(field, currentValue),
      category,
      kind: "action",
      right: field.type,
      searchText: `${category} ${paneLabel} ${field.label} ${field.description || ""} ${field.type}`,
      action: () => options.activatePaneSettingField(
        descriptor.paneId,
        field,
        currentValue,
        { keepRouteOpen: options.keepRouteOpen },
      ),
    };
  });

  return options.query
    ? fuzzyFilter(items, options.query, (item) => `${item.label} ${item.detail} ${item.right || ""} ${item.searchText || ""}`)
    : items;
}
