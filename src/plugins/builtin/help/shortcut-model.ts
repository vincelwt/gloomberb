import type { CommandDef, KeyboardShortcut } from "../../../types/plugin";
import { commands as coreCommands } from "../../../components/command-bar/command-registry";
import { getSharedRegistry } from "../../registry";
import type { HelpShortcutEntry } from "./components";

type SharedRegistry = ReturnType<typeof getSharedRegistry>;

export function resolveWindowTemplates(registry: SharedRegistry): HelpShortcutEntry[] {
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
        category: pluginName ?? "Core Panes",
      };
    })
    .sort(sortShortcutEntries);
}

function resolveDisabledPlugins(registry: SharedRegistry): Set<string> {
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

function sortShortcutEntries(left: HelpShortcutEntry, right: HelpShortcutEntry): number {
  return left.category.localeCompare(right.category)
    || left.badges.join(" ").localeCompare(right.badges.join(" "))
    || left.description.localeCompare(right.description);
}

export function resolveCommandShortcuts(registry: SharedRegistry): HelpShortcutEntry[] {
  const coreRows: HelpShortcutEntry[] = coreCommands
    .filter((command) => command.prefix.trim().length > 0)
    .map((command) => ({
      id: `core:${command.id}`,
      badges: [
        command.prefix.toUpperCase(),
        formatPlaceholder(command.argPlaceholder),
      ].filter((value): value is string => !!value),
      description: command.description,
      category: command.category,
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
        category: pluginName ?? command.category,
      };
    })
    .sort(sortShortcutEntries);

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

export function resolvePluginShortcuts(registry: SharedRegistry): HelpShortcutEntry[] {
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
        category: pluginName ?? "Plugin Shortcuts",
      };
    })
    .sort(sortShortcutEntries);
}

export function groupShortcutEntries(entries: HelpShortcutEntry[]): Array<{ title: string; entries: HelpShortcutEntry[] }> {
  const groups = new Map<string, HelpShortcutEntry[]>();
  for (const entry of entries) {
    const category = entry.category || "Other";
    groups.set(category, [...(groups.get(category) ?? []), entry]);
  }
  return [...groups.entries()]
    .map(([title, groupedEntries]) => ({ title, entries: groupedEntries }))
    .sort((left, right) => left.title.localeCompare(right.title));
}
