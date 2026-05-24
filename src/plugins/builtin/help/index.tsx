import { Box, ScrollBox, Text, useUiHost } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { useState } from "react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { getSharedRegistry } from "../../registry";
import { usePluginAppActions } from "../../runtime";
import { detectShortcutPlatform, formatPrimaryShortcut, getShortcutDisplayMode } from "../../../utils/shortcut-labels";
import {
  ActionButton,
  HelpSection,
  ShortcutGroup,
  ShortcutRow,
} from "./components";
import {
  groupShortcutEntries,
  resolveCommandShortcuts,
  resolvePluginShortcuts,
  resolveWindowTemplates,
} from "./shortcut-model";

export function HelpPane({ width, height }: PaneProps) {
  const registry = getSharedRegistry();
  const { openCommandBar, showPane } = usePluginAppActions();
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const commandShortcuts = resolveCommandShortcuts(registry);
  const pluginShortcuts = resolvePluginShortcuts(registry);
  const windowTemplates = resolveWindowTemplates(registry);
  const uiHost = useUiHost();
  const isDesktopWeb = uiHost.kind === "desktop-web";
  const shortcutPlatform = detectShortcutPlatform();
  const shortcutDisplayMode = getShortcutDisplayMode(uiHost.kind);
  const platformShortcut = (keys: string | readonly string[]) => formatPrimaryShortcut(keys, shortcutPlatform, shortcutDisplayMode);
  const commandBarBadges = shortcutDisplayMode === "terminal"
    ? ["Ctrl+P", "`"]
    : ["Ctrl+P", platformShortcut("K"), "`"];
  const copyBadges = shortcutDisplayMode === "terminal"
    ? ["Ctrl+Shift+C"]
    : [platformShortcut("C")];
  const pasteBadges = shortcutDisplayMode === "terminal"
    ? ["Ctrl+Shift+V"]
    : [platformShortcut("V")];

  const openDebugLog = () => {
    showPane("debug");
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

          <Box flexDirection="row" gap={1}>
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
              badges={commandBarBadges}
              description="Open or toggle the command bar from anywhere."
            />
            <ShortcutRow
              badges={["<ticker>"]}
              description="Search for a ticker or open the best matching security."
            />
            <ShortcutRow
              badges={["Up/Down", "Ctrl+P/N"]}
              description="Move through command bar results."
            />
            <ShortcutRow
              badges={["Enter", "Shift+Enter"]}
              description="Run the selected result or its secondary action."
            />
            <ShortcutRow
              badges={["Tab"]}
              description="Accept an inferred shortcut argument from the focused ticker."
            />
            <ShortcutRow
              badges={["Esc", "`"]}
              description="Close the command bar."
            />
          </HelpSection>

          <HelpSection title="Command Prefixes">
            {groupShortcutEntries(commandShortcuts).map((group) => (
              <ShortcutGroup
                key={group.title}
                title={group.title}
                entries={group.entries}
              />
            ))}
          </HelpSection>

          <HelpSection title="Window Templates">
            {windowTemplates.length > 0 ? groupShortcutEntries(windowTemplates).map((group) => (
              <ShortcutGroup
                key={group.title}
                title={group.title}
                entries={group.entries}
              />
            )) : (
              <Text fg={colors.textDim}>No shortcut window templates are currently registered.</Text>
            )}
          </HelpSection>

          {pluginShortcuts.length > 0 && (
            <HelpSection title="Plugin Shortcuts">
              {groupShortcutEntries(pluginShortcuts).map((group) => (
                <ShortcutGroup
                  key={group.title}
                  title={group.title}
                  entries={group.entries}
                />
              ))}
            </HelpSection>
          )}

          <HelpSection title="Global Keys">
            <ShortcutRow
              badges={["Tab", "Shift+Tab"]}
              description="Move focus between panes and floating windows."
            />
            <ShortcutRow
              badges={["Ctrl+1-9"]}
              description="Switch saved layouts by number."
            />
            <ShortcutRow
              badges={["r", "Shift+R"]}
              description="Refresh the focused ticker or refresh everything."
            />
            <ShortcutRow
              badges={["q"]}
              description="Quit the terminal app."
            />
            <ShortcutRow
              badges={copyBadges}
              description="Copy the active terminal selection."
            />
            <ShortcutRow
              badges={pasteBadges}
              description="Paste clipboard text into the active input."
            />
            <ShortcutRow
              badges={["u"]}
              description="Install an available app update when one is shown."
            />
          </HelpSection>

          <HelpSection title="Pane Management">
            <ShortcutRow
              badges={[platformShortcut("W")]}
              description="Close the focused pane, docked or floating."
            />
            <ShortcutRow
              badges={[platformShortcut(",")]}
              description="Edit settings for the focused pane."
            />
            <ShortcutRow
              badges={[platformShortcut(["Shift", "D"])]}
              description="Dock or float the focused pane."
            />
            {isDesktopWeb && (
              <ShortcutRow
                badges={[platformShortcut(["Shift", "O"])]}
                description="Pop the focused pane out to a desktop window."
              />
            )}
            <ShortcutRow
              badges={[platformShortcut(["Shift", "L"])]}
              description="Open layout actions."
            />
            <ShortcutRow
              badges={[platformShortcut(["Shift", "G"])]}
              description="Gridlock all windows."
            />
            <ShortcutRow
              badges={["Esc"]}
              description="Cancel an active pane drag."
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
