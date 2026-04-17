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
    return false;
  }
  return false;
}

function resolvePath(cwd: string, ...parts: string[]): string {
  const joined = [cwd, ...parts].join("/");
  const segments: string[] = [];
  for (const part of joined.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return joined.startsWith("/") ? `/${segments.join("/")}` : segments.join("/");
}

export function resolveGloomberbCliCommand({
  cwd = typeof process !== "undefined" ? process.cwd() : ".",
  hasCommand = commandExists,
  fileExists = () => false,
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

  const sourceEntry = resolvePath(cwd, "src", "index.tsx");
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
