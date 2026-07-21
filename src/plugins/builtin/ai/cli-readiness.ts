import { withDeadline } from "../../../utils/async-deadline";
import {
  getAiProviderDefinitions,
  type AiProvider,
  type AiProviderAvailability,
  type AiProviderDefinition,
} from "./providers";

const LOGIN_SHELL_ENV_MARKER = "__GLOOMBERB_LOGIN_ENV__";
const LOGIN_SHELL_TIMEOUT_MS = 3_000;
const AUTH_PROBE_TIMEOUT_MS = 15_000;

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunCommandOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

type CommandRunner = (
  executable: string,
  args: string[],
  options: RunCommandOptions,
) => Promise<CommandResult>;

interface AuthProbe {
  args: string[];
  loginCommand: string;
  isReady(result: CommandResult): boolean;
}

const AUTH_PROBES: Record<string, AuthProbe | null> = {
  claude: {
    args: ["auth", "status", "--json"],
    loginCommand: "claude auth login",
    isReady(result) {
      if (result.exitCode !== 0) return false;
      const start = result.stdout.indexOf("{");
      const end = result.stdout.lastIndexOf("}");
      if (start < 0 || end < start) return false;
      try {
        return JSON.parse(result.stdout.slice(start, end + 1)).loggedIn === true;
      } catch {
        return false;
      }
    },
  },
  gemini: {
    // Gemini has no auth-status command. This command performs its normal
    // non-interactive auth validation and OAuth refresh, then exits before a
    // prompt is sent.
    args: ["--list-extensions"],
    loginCommand: "gemini",
    isReady: (result) => result.exitCode === 0,
  },
  codex: {
    args: ["login", "status"],
    loginCommand: "codex login",
    isReady: (result) => result.exitCode === 0,
  },
  // Pi has no side-effect-free authentication status command. Treat an
  // installed executable as runnable and surface credential failures at run time.
  pi: null,
};

export interface ResolvedAiProvider {
  provider: AiProvider;
  environment: NodeJS.ProcessEnv;
}

export interface DiscoverAiCliProvidersOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  recoverLoginShellPath?: boolean;
  searchPath?: string;
  which?: (command: string, searchPath: string) => string | null;
  runCommand?: CommandRunner;
  loadLoginShellEnvironment?: (basePath: string) => Promise<NodeJS.ProcessEnv | null>;
}

function mergeSearchPaths(
  paths: Array<string | null | undefined>,
  delimiter: string,
): string {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    for (const entry of path?.split(delimiter) ?? []) {
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      entries.push(trimmed);
    }
  }
  return entries.join(delimiter);
}

function appendPath(base: string, platform: NodeJS.Platform, ...segments: string[]): string {
  const separator = platform === "win32" ? "\\" : "/";
  const trimmedBase = base.replace(/[\\/]+$/, "");
  const trimmedSegments = segments.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""));
  return [trimmedBase, ...trimmedSegments].filter(Boolean).join(separator);
}

async function runCommand(
  executable: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const child = Bun.spawn([executable, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  return withDeadline(
    (async () => {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    })(),
    options.timeoutMs,
    `${executable} readiness check timed out`,
    () => {
      try {
        child.kill();
      } catch {
        // Process may already have exited.
      }
    },
  );
}

async function readLoginShellEnvironment(
  basePath: string,
  env: NodeJS.ProcessEnv,
  runner: CommandRunner,
): Promise<NodeJS.ProcessEnv | null> {
  const shell = env.SHELL || "/bin/zsh";
  const result = await runner(
    shell,
    ["-ilc", `printf '\\0${LOGIN_SHELL_ENV_MARKER}\\0'; env -0`],
    {
      env: { ...env, PATH: basePath },
      timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
    },
  );
  if (result.exitCode !== 0) return null;
  const marker = `\0${LOGIN_SHELL_ENV_MARKER}\0`;
  const markerIndex = result.stdout.lastIndexOf(marker);
  if (markerIndex < 0) return null;

  const loginEnvironment: NodeJS.ProcessEnv = {};
  for (const entry of result.stdout.slice(markerIndex + marker.length).split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    loginEnvironment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return loginEnvironment;
}

export async function resolveAiCliEnvironment(
  options: DiscoverAiCliProvidersOptions = {},
): Promise<NodeJS.ProcessEnv> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const basePath = options.searchPath ?? env.PATH ?? "";
  const home = options.homeDir ?? env.HOME ?? env.USERPROFILE ?? "";
  const runner = options.runCommand ?? runCommand;
  let loginEnvironment: NodeJS.ProcessEnv | null = null;

  if (options.recoverLoginShellPath && platform !== "win32") {
    try {
      loginEnvironment = await (options.loadLoginShellEnvironment
        ? options.loadLoginShellEnvironment(basePath)
        : readLoginShellEnvironment(basePath, env, runner));
    } catch {
      loginEnvironment = null;
    }
  }

  const delimiter = platform === "win32" ? ";" : ":";
  const commonUserPaths = platform === "win32"
    ? [
        home ? appendPath(home, platform, ".local", "bin") : null,
        home ? appendPath(home, platform, ".bun", "bin") : null,
        env.APPDATA ? appendPath(env.APPDATA, platform, "npm") : null,
      ]
    : [
        home ? appendPath(home, platform, ".local", "bin") : null,
        home ? appendPath(home, platform, ".bun", "bin") : null,
        home ? appendPath(home, platform, ".npm-global", "bin") : null,
        home ? appendPath(home, platform, ".claude", "local") : null,
        home ? appendPath(home, platform, ".volta", "bin") : null,
        ...(platform === "darwin"
          ? ["/opt/homebrew/bin", "/usr/local/bin"]
          : ["/home/linuxbrew/.linuxbrew/bin", "/usr/local/bin"]),
      ];

  return {
    ...env,
    ...loginEnvironment,
    PATH: mergeSearchPaths([loginEnvironment?.PATH, ...commonUserPaths, basePath], delimiter),
  };
}

export async function resolveAiCliSearchPath(
  options: DiscoverAiCliProvidersOptions = {},
): Promise<string> {
  return (await resolveAiCliEnvironment(options)).PATH ?? "";
}

function missingAvailability(provider: AiProviderDefinition): AiProviderAvailability {
  return {
    available: false,
    status: "missing",
    unavailableReason: `${provider.name} is not installed or was not found in PATH.`,
  };
}

function unauthenticatedAvailability(
  provider: AiProviderDefinition,
  probe: AuthProbe,
): AiProviderAvailability {
  return {
    available: false,
    status: "not_authenticated",
    unavailableReason: `${provider.name} is installed but is not authenticated. Run ${probe.loginCommand} in a terminal.`,
  };
}

function failedCheckAvailability(provider: AiProviderDefinition): AiProviderAvailability {
  return {
    available: false,
    status: "check_failed",
    unavailableReason: `${provider.name} is installed, but Gloomberb could not verify that it is ready.`,
  };
}

export async function discoverAiCliProviders(
  options: DiscoverAiCliProvidersOptions = {},
): Promise<ResolvedAiProvider[]> {
  const environment = await resolveAiCliEnvironment(options);
  const searchPath = environment.PATH ?? "";
  const runner = options.runCommand ?? runCommand;
  const which = options.which ?? ((command, path) => Bun.which(command, { PATH: path }));

  return Promise.all(getAiProviderDefinitions().map(async (definition) => {
    const executable = which(definition.command, searchPath);
    if (!executable) {
      return {
        provider: { ...definition, ...missingAvailability(definition) },
        environment,
      };
    }

    const probe = AUTH_PROBES[definition.id];
    if (probe === null) {
      return {
        provider: {
          ...definition,
          command: executable,
          available: true,
          status: "ready" as const,
        },
        environment,
      };
    }
    if (!probe) {
      return {
        provider: { ...definition, command: executable, ...failedCheckAvailability(definition) },
        environment,
      };
    }

    try {
      const result = await runner(executable, probe.args, {
        cwd: options.cwd,
        env: environment,
        timeoutMs: AUTH_PROBE_TIMEOUT_MS,
      });
      const availability = probe.isReady(result)
        ? { available: true, status: "ready" as const }
        : unauthenticatedAvailability(definition, probe);
      return {
        provider: { ...definition, command: executable, ...availability },
        environment,
      };
    } catch {
      return {
        provider: { ...definition, command: executable, ...failedCheckAvailability(definition) },
        environment,
      };
    }
  }));
}
