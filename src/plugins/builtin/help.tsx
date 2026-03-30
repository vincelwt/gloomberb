import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { colors, hoverBg } from "../../theme/colors";
import { getSharedRegistry } from "../registry";

function ShortcutBadge({ label }: { label: string }) {
  return (
    <box backgroundColor={colors.selected}>
      <text fg={colors.selectedText} attributes={TextAttributes.BOLD}>
        {` ${label} `}
      </text>
    </box>
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
    <box flexDirection={compact ? "column" : "row"} gap={1}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        {badges.map((badge) => <ShortcutBadge key={badge} label={badge} />)}
      </box>
      <box flexGrow={1}>
        <text fg={colors.text}>{description}</text>
      </box>
    </box>
  );
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <box flexDirection="column">
      <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</text>
      <box height={1} />
      {children}
    </box>
  );
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
    <box
      backgroundColor={hovered ? hoverBg() : colors.panel}
      onMouseMove={() => onHover(id)}
      onMouseOut={() => onHover(null)}
      onMouseDown={(event: any) => {
        event.stopPropagation?.();
        event.preventDefault?.();
        onPress();
      }}
    >
      <text fg={hovered ? colors.textBright : colors.text}>{` ${label} `}</text>
    </box>
  );
}

function resolveWindowTemplates(registry: ReturnType<typeof getSharedRegistry>) {
  if (!registry || !registry.paneTemplates) return [];

  const disabledPlugins = new Set(registry.getConfigFn?.().disabledPlugins ?? []);
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

export function HelpPane({ focused, width, height, close }: PaneProps) {
  const registry = getSharedRegistry();
  const compact = width < 78;
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const windowTemplates = resolveWindowTemplates(registry);

  useKeyboard((event) => {
    if (!focused) return;
    if (event.name === "escape") {
      close?.();
    }
  });

  const openDebugLog = () => {
    close?.();
    registry?.showWidget("debug");
  };

  const openLayoutActions = () => {
    close?.();
    registry?.openCommandBarFn("LAY ");
  };

  const openPluginManager = () => {
    close?.();
    registry?.openCommandBarFn("PL ");
  };

  return (
    <box flexDirection="column" width={width} height={height}>
      <scrollbox flexGrow={1} scrollY>
        <box flexDirection="column" padding={1}>
          <box flexDirection="column" gap={1}>
            <text fg={colors.textBright} attributes={TextAttributes.BOLD}>How To Use Gloomberb</text>
            <box flexDirection="column">
              <text fg={colors.textDim}>Gloomberb is command-bar first.</text>
              <text fg={colors.textDim}>Use the keyboard for speed, and the mouse for windows.</text>
            </box>
          </box>

          <box flexDirection={compact ? "column" : "row"} gap={1}>
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
          </box>

          <HelpSection title="Command Bar">
            <ShortcutRow
              badges={["Ctrl+P", "`"]}
              description="Open the command bar from anywhere."
              compact={compact}
            />
            <ShortcutRow
              badges={["help"]}
              description="Open this help window directly."
              compact={compact}
            />
            <ShortcutRow
              badges={["T <ticker>"]}
              description="Search for a ticker or company and open it."
              compact={compact}
            />
            <ShortcutRow
              badges={["NP", "PS", "PL"]}
              description="Create panes, edit pane settings, and manage plugins."
              compact={compact}
            />
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
              <text fg={colors.textDim}>No shortcut window templates are currently registered.</text>
            )}
          </HelpSection>

          <HelpSection title="Move Around">
            <ShortcutRow
              badges={["Tab", "Shift+Tab"]}
              description="Move focus between panes and floating windows."
              compact={compact}
            />
            <ShortcutRow
              badges={["Ctrl+W"]}
              description="Close the focused pane, docked or floating."
              compact={compact}
            />
            <ShortcutRow
              badges={["j", "k"]}
              description="Move through lists in most panes. Arrow keys also work."
              compact={compact}
            />
            <ShortcutRow
              badges={["r", "Shift+R"]}
              description="Refresh the focused ticker or refresh everything."
              compact={compact}
            />
          </HelpSection>

          <HelpSection title="Layout System">
            <ShortcutRow
              badges={["LAY"]}
              description="Open layout actions."
              compact={compact}
            />
            <text fg={colors.text}>Docked panes stay in the saved layout.</text>
            <box flexDirection="column">
              <text fg={colors.text}>Floating panes can be dragged by the title bar</text>
              <text fg={colors.text}>and resized from the lower-right corner.</text>
            </box>
            <text fg={colors.text}>Run Gridlock All Windows if the layout gets messy.</text>
          </HelpSection>

          <HelpSection title="If There Is A Bug">
            <text fg={colors.text}>Open Debug Log, then run Export Debug Log from the command bar.</text>
            <box flexDirection="column">
              <text fg={colors.text}>The file lands in ~/Downloads. Include steps, ticker or layout, plugin,</text>
              <text fg={colors.text}>and a screenshot if it is visual.</text>
            </box>
          </HelpSection>
        </box>
      </scrollbox>

      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>Esc closes this window. Ctrl+W closes the focused pane.</text>
      </box>
    </box>
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
