import { Box, ScrollBox, Text } from "../../ui";
import { TextAttributes } from "../../ui";
import { useState } from "react";
import type { ReactNode } from "react";
import type { CommandDef, GloomPlugin, KeyboardShortcut, PaneProps } from "../../types/plugin";
import { colors, hoverBg } from "../../theme/colors";
import { getSharedRegistry } from "../registry";
import { usePluginAppActions } from "../plugin-runtime";
import { commands as coreCommands } from "../../components/command-bar/command-registry";
import { detectShortcutPlatform, formatPrimaryShortcut } from "../../utils/shortcut-labels";

function ShortcutBadge({ label }: { label: string }) {
  return (
    <Box backgroundColor={colors.selected}>
      <Text fg={colors.selectedText} attributes={TextAttributes.BOLD}>
        {` ${label} `}
      </Text>
    </Box>
  );
}

function ShortcutRow({
  badges,
  description,
  compact,
}: {
  badges: string[];
  description: string;
  compact: boolean;
}) {
  return (
    <Box flexDirection={compact ? "column" : "row"} gap={1}>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {badges.map((badge) => <ShortcutBadge key={badge} label={badge} />)}
      </Box>
      <Box flexGrow={1}>
        <Text fg={colors.text} wrapText>{description}</Text>
      </Box>
    </Box>
  );
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</Text>
      {children}
    </Box>
  );
}

interface HelpShortcutEntry {
  id: string;
  badges: string[];
  description: string;
}

function ActionButton({
  id,
  label,
  hovered,
  onHover,
  onPress,
}: {
  id: string;
  label: string;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onPress: () => void;
}) {
  return (
    <Box
      backgroundColor={hovered ? hoverBg() : colors.panel}
      onMouseMove={() => onHover(id)}
      onMouseOut={() => onHover(null)}
      onMouseDown={(event: any) => {
        event.stopPropagation?.();
        event.preventDefault?.();
        onPress();
      }}
    >
      <Text fg={hovered ? colors.textBright : colors.text}>{` ${label} `}</Text>
    </Box>
  );
}

function resolveWindowTemplates(registry: ReturnType<typeof getSharedRegistry>) {
  if (!registry || !registry.paneTemplates) return [];

  const disabledPlugins = resolveDisabledPlugins(registry);
  const allPlugins = registry.allPlugins ?? new Map<string, { name?: string }>();

  return [...registry.paneTemplates.values()]
    .filter((template) => template.shortcut)
    .filter((template) => {
      const pluginId = registry.getPaneTemplatePluginId?.(template.id);
      return !pluginId || !disabledPlugins.has(pluginId);
    })
    .map((template) => {
      const shortcut = template.shortcut!;
      const pluginId = registry.getPaneTemplatePluginId?.(template.id);
      const pluginName = pluginId ? allPlugins.get(pluginId)?.name : null;
      return {
        id: template.id,
        badges: [
          shortcut.prefix,
          shortcut.argPlaceholder ? `<${shortcut.argPlaceholder}>` : null,
        ].filter((value): value is string => !!value),
        description: pluginName ? `${template.label} (${pluginName})` : template.label,
      };
    })
    .sort((left, right) => (
      left.badges.join(" ").localeCompare(right.badges.join(" "))
      || left.description.localeCompare(right.description)
    ));
}

function resolveDisabledPlugins(registry: ReturnType<typeof getSharedRegistry>): Set<string> {
  try {
    return new Set(registry?.getConfigFn?.().disabledPlugins ?? []);
  } catch {
    return new Set();
  }
}

function formatPlaceholder(value: string | undefined): string | null {
  return value ? `<${value}>` : null;
}

function withPluginName(description: string | undefined, pluginName: string | null | undefined): string {
  const base = description?.trim() || "Run command";
  return pluginName ? `${base} (${pluginName})` : base;
}

function resolveCommandShortcuts(registry: ReturnType<typeof getSharedRegistry>): HelpShortcutEntry[] {
  const coreRows: HelpShortcutEntry[] = coreCommands
    .filter((command) => command.prefix.trim().length > 0)
    .map((command) => ({
      id: `core:${command.id}`,
      badges: [
        command.prefix.toUpperCase(),
        formatPlaceholder(command.argPlaceholder),
      ].filter((value): value is string => !!value),
      description: command.description,
    }));

  if (!registry || !registry.commands) return coreRows;

  const disabledPlugins = resolveDisabledPlugins(registry);
  const allPlugins = registry.allPlugins ?? new Map<string, { name?: string }>();
  const pluginRows = [...registry.commands.values()]
    .filter((command: CommandDef) => command.shortcut?.trim().length)
    .filter((command: CommandDef) => {
      const pluginId = registry.getCommandPluginId?.(command.id);
      if (pluginId && disabledPlugins.has(pluginId)) return false;
      return !(command.hidden?.() ?? false);
    })
    .map((command: CommandDef) => {
      const pluginId = registry.getCommandPluginId?.(command.id);
      const pluginName = pluginId ? allPlugins.get(pluginId)?.name : null;
      return {
        id: `plugin-command:${command.id}`,
        badges: [
          command.shortcut!.toUpperCase(),
          formatPlaceholder(command.shortcutArg?.placeholder),
        ].filter((value): value is string => !!value),
        description: withPluginName(command.label, pluginName),
      };
    })
    .sort((left, right) => (
      left.badges.join(" ").localeCompare(right.badges.join(" "))
      || left.description.localeCompare(right.description)
    ));

  return [...coreRows, ...pluginRows];
}

function formatShortcutKey(shortcut: KeyboardShortcut): string {
  const key = shortcut.key.length === 1
    ? shortcut.key.toUpperCase()
    : shortcut.key[0]!.toUpperCase() + shortcut.key.slice(1);
  return [
    shortcut.ctrl ? "Ctrl" : null,
    shortcut.shift ? "Shift" : null,
    key,
  ].filter((value): value is string => !!value).join("+");
}

function resolvePluginShortcuts(registry: ReturnType<typeof getSharedRegistry>): HelpShortcutEntry[] {
  if (!registry || !registry.shortcuts) return [];

  const disabledPlugins = resolveDisabledPlugins(registry);
  const allPlugins = registry.allPlugins ?? new Map<string, { name?: string }>();
  return [...registry.shortcuts.values()]
    .filter((shortcut: KeyboardShortcut) => {
      const pluginId = registry.getShortcutPluginId?.(shortcut.id);
      return !pluginId || !disabledPlugins.has(pluginId);
    })
    .map((shortcut: KeyboardShortcut) => {
      const pluginId = registry.getShortcutPluginId?.(shortcut.id);
      const pluginName = pluginId ? allPlugins.get(pluginId)?.name : null;
      return {
        id: `plugin-shortcut:${shortcut.id}`,
        badges: [formatShortcutKey(shortcut)],
        description: withPluginName(shortcut.description, pluginName),
      };
    })
    .sort((left, right) => (
      left.badges.join(" ").localeCompare(right.badges.join(" "))
      || left.description.localeCompare(right.description)
    ));
}

export function HelpPane({ width, height }: PaneProps) {
  const registry = getSharedRegistry();
  const { openCommandBar, showWidget } = usePluginAppActions();
  const compact = width < 78;
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const commandShortcuts = resolveCommandShortcuts(registry);
  const pluginShortcuts = resolvePluginShortcuts(registry);
  const windowTemplates = resolveWindowTemplates(registry);
  const shortcutPlatform = detectShortcutPlatform();
  const platformShortcut = (keys: string | readonly string[]) => formatPrimaryShortcut(keys, shortcutPlatform);

  const openDebugLog = () => {
    showWidget("debug");
  };

  const openLayoutActions = () => {
    openCommandBar("LAY ");
  };

  const openPluginManager = () => {
    openCommandBar("PL ");
  };

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY>
        <Box flexDirection="column" padding={1}>
          <Box flexDirection="column" gap={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>How To Use Gloomberb</Text>
            <Box flexDirection="column">
              <Text fg={colors.textDim}>Gloomberb is command-bar first.</Text>
              <Text fg={colors.textDim}>Use the keyboard for speed, and the mouse for windows.</Text>
            </Box>
          </Box>

          <Box flexDirection={compact ? "column" : "row"} gap={1}>
            <ActionButton
              id="debug"
              label="Open Debug Log"
              hovered={hoveredAction === "debug"}
              onHover={setHoveredAction}
              onPress={openDebugLog}
            />
            <ActionButton
              id="layout"
              label="Layout Actions"
              hovered={hoveredAction === "layout"}
              onHover={setHoveredAction}
              onPress={openLayoutActions}
            />
            <ActionButton
              id="plugins"
              label="Manage Plugins"
              hovered={hoveredAction === "plugins"}
              onHover={setHoveredAction}
              onPress={openPluginManager}
            />
          </Box>

          <HelpSection title="Command Bar">
            <ShortcutRow
              badges={["Ctrl+P", "Cmd+K", "`"]}
              description="Open or toggle the command bar from anywhere."
              compact={compact}
            />
            <ShortcutRow
              badges={["<ticker>"]}
              description="Search for a ticker or open the best matching security."
              compact={compact}
            />
            <ShortcutRow
              badges={["Up/Down", "Ctrl+P/N"]}
              description="Move through command bar results."
              compact={compact}
            />
            <ShortcutRow
              badges={["Enter", "Shift+Enter"]}
              description="Run the selected result or its secondary action."
              compact={compact}
            />
            <ShortcutRow
              badges={["Tab"]}
              description="Accept an inferred shortcut argument from the focused ticker."
              compact={compact}
            />
            <ShortcutRow
              badges={["Esc", "`"]}
              description="Close the command bar."
              compact={compact}
            />
          </HelpSection>

          <HelpSection title="Command Prefixes">
            {commandShortcuts.map((shortcut) => (
              <ShortcutRow
                key={shortcut.id}
                badges={shortcut.badges}
                description={shortcut.description}
                compact={compact}
              />
            ))}
          </HelpSection>

          <HelpSection title="Window Templates">
            {windowTemplates.length > 0 ? windowTemplates.map((template) => (
              <ShortcutRow
                key={template.id}
                badges={template.badges}
                description={template.description}
                compact={compact}
              />
            )) : (
              <Text fg={colors.textDim}>No shortcut window templates are currently registered.</Text>
            )}
          </HelpSection>

          {pluginShortcuts.length > 0 && (
            <HelpSection title="Plugin Shortcuts">
              {pluginShortcuts.map((shortcut) => (
                <ShortcutRow
                  key={shortcut.id}
                  badges={shortcut.badges}
                  description={shortcut.description}
                  compact={compact}
                />
              ))}
            </HelpSection>
          )}

          <HelpSection title="Global Keys">
            <ShortcutRow
              badges={["Tab", "Shift+Tab"]}
              description="Move focus between panes and floating windows."
              compact={compact}
            />
            <ShortcutRow
              badges={["Ctrl+1-9"]}
              description="Switch saved layouts by number."
              compact={compact}
            />
            <ShortcutRow
              badges={["r", "Shift+R"]}
              description="Refresh the focused ticker or refresh everything."
              compact={compact}
            />
            <ShortcutRow
              badges={["a"]}
              description="Open ticker actions for the focused ticker."
              compact={compact}
            />
            <ShortcutRow
              badges={["q"]}
              description="Quit the terminal app."
              compact={compact}
            />
            <ShortcutRow
              badges={["Cmd+C", "Ctrl+Shift+C"]}
              description="Copy the active terminal selection."
              compact={compact}
            />
            <ShortcutRow
              badges={["Cmd+V", "Ctrl+Shift+V"]}
              description="Paste clipboard text into the active input."
              compact={compact}
            />
            <ShortcutRow
              badges={["u"]}
              description="Install an available app update when one is shown."
              compact={compact}
            />
          </HelpSection>

          <HelpSection title="Pane Management">
            <ShortcutRow
              badges={[platformShortcut("W")]}
              description="Close the focused pane, docked or floating."
              compact={compact}
            />
            <ShortcutRow
              badges={[platformShortcut(",")]}
              description="Edit settings for the focused pane."
              compact={compact}
            />
            <ShortcutRow
              badges={[platformShortcut(["Shift", "D"])]}
              description="Dock or float the focused pane."
              compact={compact}
            />
            <ShortcutRow
              badges={[platformShortcut(["Shift", "O"])]}
              description="Pop the focused pane out to a desktop window."
              compact={compact}
            />
            <ShortcutRow
              badges={[platformShortcut(["Shift", "L"])]}
              description="Open layout actions."
              compact={compact}
            />
            <ShortcutRow
              badges={[platformShortcut(["Shift", "G"])]}
              description="Gridlock all windows."
              compact={compact}
            />
            <ShortcutRow
              badges={["Esc"]}
              description="Cancel an active pane drag."
              compact={compact}
            />
          </HelpSection>

          <HelpSection title="Layout System">
            <Text fg={colors.text}>Docked panes stay in the saved layout.</Text>
            <Box flexDirection="column">
              <Text fg={colors.text}>Floating panes can be dragged by the title bar</Text>
              <Text fg={colors.text}>and resized from the lower-right corner.</Text>
            </Box>
            <Text fg={colors.text}>Use Layout Actions for split, move, duplicate, undo, redo, and layout presets.</Text>
          </HelpSection>

          <HelpSection title="If There Is A Bug">
            <Text fg={colors.text}>Open Debug Log, then run Export Debug Log from the command bar.</Text>
            <Box flexDirection="column">
              <Text fg={colors.text}>The file lands in ~/Downloads. Include steps, ticker or layout, plugin,</Text>
              <Text fg={colors.text}>and a screenshot if it is visual.</Text>
            </Box>
          </HelpSection>
        </Box>
      </ScrollBox>
    </Box>
  );
}

export const helpPlugin: GloomPlugin = {
  id: "help",
  name: "Help",
  version: "1.0.0",
  description: "Shortcut and layout help",

  panes: [
    {
      id: "help",
      name: "Help",
      icon: "?",
      component: HelpPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 88, height: 32 },
    },
  ],
};
