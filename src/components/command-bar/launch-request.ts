import { useEffect, useRef } from "react";
import type { PluginRegistry } from "../../plugins/registry";
import type { CommandDef } from "../../types/plugin";

interface CommandBarPluginLaunchRequest {
  kind: "plugin-command";
  commandId: string;
  sequence: number;
}

interface UseCommandBarLaunchRequestOptions {
  activeTickerSymbol: string | null;
  commandBarLaunchRequest: CommandBarPluginLaunchRequest | null;
  commandBarOpen: boolean;
  openPluginCommandWorkflow: (
    command: CommandDef,
    options?: { values?: Record<string, string> },
  ) => void;
  pluginRegistry: PluginRegistry;
}

export function useCommandBarLaunchRequest({
  activeTickerSymbol,
  commandBarLaunchRequest,
  commandBarOpen,
  openPluginCommandWorkflow,
  pluginRegistry,
}: UseCommandBarLaunchRequestOptions) {
  const processedLaunchSequenceRef = useRef<number | null>(null);

  useEffect(() => {
    const launch = commandBarLaunchRequest;
    if (!launch) {
      processedLaunchSequenceRef.current = null;
      return;
    }
    if (!commandBarOpen) return;
    if (processedLaunchSequenceRef.current === launch.sequence) return;
    processedLaunchSequenceRef.current = launch.sequence;

    const command = pluginRegistry.commands.get(launch.commandId);
    if (!command?.wizard || command.wizard.length === 0) return;
    let values: Record<string, string> | undefined;
    try {
      values = command.shortcutArg?.parse?.("", {
        activeTicker: activeTickerSymbol,
      });
    } catch {
      values = undefined;
    }
    openPluginCommandWorkflow(command, values ? { values } : undefined);
  }, [
    activeTickerSymbol,
    commandBarLaunchRequest,
    commandBarOpen,
    openPluginCommandWorkflow,
    pluginRegistry,
  ]);
}
