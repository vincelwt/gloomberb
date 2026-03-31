import type { PaneTemplateDef } from "../../types/plugin";
import type { Command } from "./command-registry";

export type RootShortcutArgKind = "text" | "ticker" | "ticker-list";
export type ShortcutIntentKind = "none" | "complete" | "inferred-complete" | "partial" | "ambiguous";

interface ShortcutIntentBase {
  kind: Exclude<ShortcutIntentKind, "none">;
  prefix: string;
  label: string;
  description: string;
  argKind: RootShortcutArgKind | null;
  argPlaceholder?: string;
  argText: string;
  completionQuery: string | null;
}

export interface CommandShortcutIntent extends ShortcutIntentBase {
  source: "command";
  command: Command;
}

export interface PaneTemplateShortcutIntent extends ShortcutIntentBase {
  source: "pane-template";
  template: PaneTemplateDef;
}

export type ShortcutIntent =
  | { kind: "none" }
  | CommandShortcutIntent
  | PaneTemplateShortcutIntent;

interface ShortcutParseCandidate {
  prefix: string;
  label: string;
  description: string;
  argKind: RootShortcutArgKind | null;
  argPlaceholder?: string;
  source: "command" | "pane-template";
  command?: Command;
  template?: PaneTemplateDef;
}

function normalizeShortcutPrefix(value: string): string {
  return value.trim().toUpperCase();
}

function mapPlaceholderToArgKind(value: string | undefined): RootShortcutArgKind | null {
  if (value === "ticker") return "ticker";
  if (value === "tickers") return "ticker-list";
  if (value) return "text";
  return null;
}

export function getPaneShortcutArgKind(template: PaneTemplateDef): RootShortcutArgKind | null {
  return template.shortcut?.argKind ?? mapPlaceholderToArgKind(template.shortcut?.argPlaceholder);
}

export function getCommandShortcutArgKind(command: Command): RootShortcutArgKind | null {
  return mapPlaceholderToArgKind(command.argPlaceholder) ?? (command.hasArg ? "text" : null);
}

function inferShortcutArg(argKind: RootShortcutArgKind | null, activeTicker: string | null): string | null {
  if (!activeTicker) return null;
  if (argKind === "ticker" || argKind === "ticker-list") {
    return activeTicker;
  }
  return null;
}

function buildShortcutCandidates(
  commands: Command[],
  paneTemplates: PaneTemplateDef[],
): ShortcutParseCandidate[] {
  return [
    ...commands
      .filter((command) => command.prefix.trim().length > 0)
      .map((command) => ({
        prefix: normalizeShortcutPrefix(command.prefix),
        label: command.label,
        description: command.description,
        argKind: getCommandShortcutArgKind(command),
        argPlaceholder: command.argPlaceholder,
        source: "command" as const,
        command,
      })),
    ...paneTemplates
      .filter((template) => template.shortcut?.prefix)
      .map((template) => ({
        prefix: normalizeShortcutPrefix(template.shortcut!.prefix),
        label: template.label,
        description: template.description,
        argKind: getPaneShortcutArgKind(template),
        argPlaceholder: template.shortcut?.argPlaceholder,
        source: "pane-template" as const,
        template,
      })),
  ].sort((a, b) => b.prefix.length - a.prefix.length);
}

export function parseRootShortcutIntent({
  query,
  commands,
  paneTemplates,
  activeTicker,
}: {
  query: string;
  commands: Command[];
  paneTemplates: PaneTemplateDef[];
  activeTicker: string | null;
}): ShortcutIntent {
  const trimmed = query.trim();
  if (!trimmed) return { kind: "none" };

  const upper = trimmed.toUpperCase();
  const match = buildShortcutCandidates(commands, paneTemplates).find((candidate) => (
    upper === candidate.prefix || upper.startsWith(`${candidate.prefix} `)
  ));
  if (!match) return { kind: "none" };

  const argText = trimmed.slice(match.prefix.length).trim();
  const inferredArg = inferShortcutArg(match.argKind, activeTicker);
  const completionQuery = inferredArg ? `${match.prefix} ${inferredArg}` : null;

  let kind: Exclude<ShortcutIntentKind, "none">;
  if (argText.length > 0) {
    kind = match.argKind === "ticker-list" && /[,\n]\s*$/.test(trimmed) ? "partial" : "complete";
  } else if (completionQuery) {
    kind = "inferred-complete";
  } else {
    kind = "partial";
  }

  const base: ShortcutIntentBase = {
    kind,
    prefix: match.prefix,
    label: match.label,
    description: match.description,
    argKind: match.argKind,
    argPlaceholder: match.argPlaceholder,
    argText,
    completionQuery,
  };

  if (match.source === "command" && match.command) {
    return {
      ...base,
      source: "command",
      command: match.command,
    };
  }

  return {
    ...base,
    source: "pane-template",
    template: match.template!,
  };
}
