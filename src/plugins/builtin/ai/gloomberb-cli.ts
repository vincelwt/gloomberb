import { existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

export interface GloomberbCliCommand {
  argv: string[];
  display: string;
  mode: "installed" | "bun-source" | "unavailable";
}

function commandExists(command: string): boolean {
  try {
    if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
      return !!Bun.which(command);
    }
  } catch {
    // Fall back to shell lookup when Bun.which is unavailable.
  }

  try {
    execSync(`command -v ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function resolveGloomberbCliCommand({
  cwd = process.cwd(),
  hasCommand = commandExists,
  fileExists = existsSync,
}: {
  cwd?: string;
  hasCommand?: (command: string) => boolean;
  fileExists?: (path: string) => boolean;
} = {}): GloomberbCliCommand {
  if (hasCommand("gloomberb")) {
    return {
      argv: ["gloomberb"],
      display: "gloomberb",
      mode: "installed",
    };
  }

  const sourceEntry = resolve(cwd, "src", "index.tsx");
  if (fileExists(sourceEntry)) {
    return {
      argv: ["bun", sourceEntry],
      display: `bun ${sourceEntry}`,
      mode: "bun-source",
    };
  }

  return {
    argv: [],
    display: "gloomberb",
    mode: "unavailable",
  };
}

export function buildGloomberbCliInstructions(command = resolveGloomberbCliCommand()): string[] {
  const base = command.display;
  return [
    `The local Gloomberb CLI is available as: ${base}`,
    `Useful commands: ${base} help`,
    `Inspect a ticker with: ${base} ticker <symbol>`,
    `Inspect a portfolio or watchlist with: ${base} portfolio [name]`,
    "The CLI does not search for unknown companies, so use it to validate ticker candidates before returning them.",
  ];
}
