import { useCallback } from "react";
import type { AppState } from "../../state/app-context";
import type { PluginRegistry } from "../../plugins/registry";
import type { CommandDef, CommandResultDef } from "../../types/plugin";
import {
  getFirstVisibleFieldId,
  looksDestructiveCommand,
  normalizeWizardFields,
} from "./helpers";
import type { ResultItem } from "./list-model";
import {
  buildPluginCommandItem,
  buildPluginCommandResultItem,
  getAvailablePluginCommandsForState,
  runPluginCommandDirect as runPluginCommandDirectAction,
} from "./plugin-command-items";
import type { CommandBarWorkflowRoute } from "./workflow/workflow-types";

type CloseAllFn = (options?: { revertThemePreview?: boolean }) => void;
type NotifyFn = (body: string, options?: { type?: "info" | "success" | "error" }) => void;

type OpenInlineConfirmFn = (options: {
  confirmId: string;
  title: string;
  body: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
  successBehavior?: "close" | "back" | "stay";
}) => void;

interface UseCommandBarPluginCommandActionsOptions {
  activeCollectionId: string | null;
  activeTickerSymbol: string | null;
  closeAll: CloseAllFn;
  config: AppState["config"];
  notify: NotifyFn;
  openInlineConfirm: OpenInlineConfirmFn;
  openWorkflowRoute: (route: CommandBarWorkflowRoute) => void;
  pluginRegistry: PluginRegistry;
}

export function useCommandBarPluginCommandActions({
  activeCollectionId,
  activeTickerSymbol,
  closeAll,
  config,
  notify,
  openInlineConfirm,
  openWorkflowRoute,
  pluginRegistry,
}: UseCommandBarPluginCommandActionsOptions) {
  const resolvePluginCommandConfirm = useCallback((command: CommandDef) => {
    const context = {
      config,
      layout: config.layout,
      activeTicker: activeTickerSymbol,
      activeCollectionId,
    };
    if (typeof command.confirm === "function") {
      return command.confirm(context);
    }
    if (command.confirm) {
      return command.confirm;
    }
    if (!looksDestructiveCommand(command)) {
      return null;
    }
    return {
      title: command.label,
      body: [command.description || `Run ${command.label.toLowerCase()}?`],
      confirmLabel: command.label,
      cancelLabel: "Back",
      tone: "danger" as const,
    };
  }, [activeCollectionId, activeTickerSymbol, config]);

  const openPluginCommandWorkflow = useCallback((
    command: CommandDef,
    options?: { values?: Record<string, string> },
  ) => {
    if (!command.wizard || command.wizard.length === 0) return;
    const normalized = normalizeWizardFields(command.wizard);
    const values = {
      ...normalized.initialValues,
      ...(options?.values ?? {}),
    };
    openWorkflowRoute({
      kind: "workflow",
      workflowId: `plugin-command:${command.id}`,
      title: command.label,
      subtitle: command.description,
      description: normalized.description,
      fields: normalized.fields,
      values,
      activeFieldId: getFirstVisibleFieldId(normalized.fields, values),
      submitLabel: command.label,
      cancelLabel: "Back",
      pendingLabel: normalized.pendingLabel,
      successLabel: normalized.successLabel,
      pending: false,
      error: null,
      successBehavior: "close",
      payload: {
        kind: "plugin-command",
        actionId: command.id,
      },
    });
  }, [openWorkflowRoute]);

  const getAvailablePluginCommands = useCallback((): CommandDef[] => {
    return getAvailablePluginCommandsForState(pluginRegistry, config.disabledPlugins || []);
  }, [config.disabledPlugins, pluginRegistry]);

  const runPluginCommandDirect = useCallback(async (
    command: CommandDef,
    values?: Record<string, string>,
  ) => {
    await runPluginCommandDirectAction({
      closeAll,
      command,
      notify,
      values,
    });
  }, [closeAll, notify]);

  const createPluginCommandItem = useCallback((
    command: CommandDef,
    options?: { shortcutArg?: string },
  ): ResultItem => buildPluginCommandItem({
    activeTicker: activeTickerSymbol,
    command,
    notify,
    openInlineConfirm,
    openPluginCommandWorkflow,
    pluginRegistry,
    resolvePluginCommandConfirm,
    runPluginCommandDirect,
    shortcutArg: options?.shortcutArg,
  }), [
    activeTickerSymbol,
    notify,
    openInlineConfirm,
    openPluginCommandWorkflow,
    pluginRegistry,
    resolvePluginCommandConfirm,
    runPluginCommandDirect,
  ]);

  const createPluginCommandResultItem = useCallback((
    command: CommandDef,
    result: CommandResultDef,
  ): ResultItem => buildPluginCommandResultItem({
    closeAll,
    command,
    notify,
    pluginRegistry,
    result,
  }), [closeAll, notify, pluginRegistry]);

  const pluginCommandResultItems = useCallback((
    command: CommandDef,
    shortcutArg: string,
  ): ResultItem[] => {
    const results = command.buildResults?.(shortcutArg) ?? [];
    return results.map((result) => createPluginCommandResultItem(command, result));
  }, [createPluginCommandResultItem]);

  const pluginCommandItems = useCallback((): ResultItem[] => {
    return getAvailablePluginCommands().map((command) => createPluginCommandItem(command));
  }, [createPluginCommandItem, getAvailablePluginCommands]);

  return {
    createPluginCommandItem,
    getAvailablePluginCommands,
    openPluginCommandWorkflow,
    pluginCommandItems,
    pluginCommandResultItems,
  };
}
