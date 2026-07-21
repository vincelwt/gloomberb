import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAiCliProviders } from "./cli-readiness";
import type { AiProvider } from "./providers";
import { AiStructuredStreamParser } from "./stream-events";

export class AiRunCancelledError extends Error {
  constructor() {
    super("AI run cancelled");
    this.name = "AiRunCancelledError";
  }
}

export interface AiRunController {
  done: Promise<string>;
  cancel: () => void;
}

export interface AiRunHost {
  run(options: {
    provider: AiProvider;
    prompt: string;
    cwd?: string;
    environment?: NodeJS.ProcessEnv;
    onChunk?: (output: string) => void;
    outputMode?: "plain" | "structured";
    isolatedWorkspace?: boolean;
  }): AiRunController;
  checkStatus?(provider: AiProvider): Promise<AiProviderStatus>;
}

export interface AiProviderStatus {
  available: boolean;
  authenticated: boolean;
  /** True when the check could not determine auth state, such as a timeout or spawn failure. */
  inconclusive?: boolean;
  message: string | null;
}

let configuredHost: AiRunHost | null = null;

export function setAiRunHost(host: AiRunHost | null): void {
  configuredHost = host;
}

export function isAiRunCancelled(error: unknown): boolean {
  return error instanceof AiRunCancelledError;
}

function remediationFor(provider: AiProvider, reason: "unavailable" | "unauthenticated"): string {
  if (reason === "unavailable") {
    return `${provider.name} is not installed or not available in PATH.`;
  }
  const loginCommand = provider.authLoginCommand ?? provider.command;
  return `${provider.name} is installed but not authenticated. Run \`${loginCommand}\` in your terminal.`;
}

function sanitizeRuntimeError(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/((?:access[_ -]?token|auth[_ -]?token|oauth[_ -]?token|claude_code_oauth_token|api[_ -]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"']+/gi, "$1[redacted]")
    .trim()
    .slice(0, 2_000);
}

export async function checkStatusWithBun(
  provider: AiProvider,
): Promise<AiProviderStatus> {
  if (typeof Bun === "undefined" || typeof Bun.spawn !== "function") {
    return { available: false, authenticated: false, message: "Local AI status checks require a native Bun host." };
  }
  try {
    const resolved = (await discoverAiCliProviders({
      cwd: typeof process !== "undefined" ? process.cwd() : undefined,
      recoverLoginShellPath: false,
    })).find(({ provider: candidate }) => candidate.id === provider.id)?.provider;
    if (!resolved || resolved.status === "missing") {
      return { available: false, authenticated: false, message: remediationFor(provider, "unavailable") };
    }
    if (resolved.status === "ready") {
      return { available: true, authenticated: true, message: null };
    }
    if (resolved.status === "not_authenticated") {
      return {
        available: true,
        authenticated: false,
        message: resolved.unavailableReason ?? remediationFor(provider, "unauthenticated"),
      };
    }
    return {
      available: true,
      authenticated: false,
      inconclusive: true,
      message: resolved.unavailableReason ?? `${provider.name} authentication check failed.`,
    };
  } catch (error) {
    return {
      available: true,
      authenticated: false,
      inconclusive: true,
      message: sanitizeRuntimeError(error instanceof Error
        ? error.message
        : `${provider.name} authentication check failed.`),
    };
  }
}

export function checkAiProviderStatus(provider: AiProvider): Promise<AiProviderStatus> {
  return configuredHost?.checkStatus?.(provider) ?? checkStatusWithBun(provider);
}

function runWithBun({
  provider,
  prompt,
  cwd = typeof process !== "undefined" ? process.cwd() : ".",
  environment,
  onChunk,
  outputMode = "plain",
  isolatedWorkspace = false,
}: {
  provider: AiProvider;
  prompt: string;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  onChunk?: (output: string) => void;
  outputMode?: "plain" | "structured";
  isolatedWorkspace?: boolean;
}): AiRunController {
  type BunSubprocess = ReturnType<typeof Bun.spawn>;
  if (typeof Bun === "undefined" || typeof Bun.spawn !== "function") {
    return {
      done: Promise.reject(new Error("AI execution requires a native Bun host.")),
      cancel: () => {},
    };
  }

  let cancelled = false;
  let processRef: BunSubprocess | null = null;

  const done = (async () => {
    if (cancelled) throw new AiRunCancelledError();

    const args = outputMode === "structured"
      ? provider.buildStructuredArgs?.(prompt)
      : provider.buildArgs(prompt);
    if (!args) {
      throw new Error(`${provider.name} does not support structured non-interactive output.`);
    }

    const isolatedCwd = isolatedWorkspace
      ? await mkdtemp(join(tmpdir(), "gloomberb-local-agent-"))
      : null;
    let proc: BunSubprocess | null = null;
    try {
      if (cancelled) throw new AiRunCancelledError();
      proc = Bun.spawn([provider.command, ...args], {
        cwd: isolatedCwd ?? cwd,
        env: environment,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      processRef = proc;

      const stderrPromise = new Response(proc.stderr).text().catch(() => "");
      const stdoutReader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let fullOutput = "";
      const structuredParser = outputMode === "structured"
        ? new AiStructuredStreamParser(provider.id)
        : null;

      while (true) {
        const { done: streamDone, value } = await stdoutReader.read();
        if (streamDone) break;
        if (cancelled) throw new AiRunCancelledError();
        const decoded = decoder.decode(value, { stream: true });
        if (structuredParser) {
          const nextOutput = structuredParser.push(decoded).transcript;
          if (nextOutput !== fullOutput) {
            fullOutput = nextOutput;
            onChunk?.(fullOutput);
          }
        } else {
          fullOutput += decoded;
          onChunk?.(fullOutput);
        }
      }

      const tail = decoder.decode();
      if (structuredParser && tail) structuredParser.push(tail);
      const structuredResult = structuredParser?.finish();
      if (structuredResult && structuredResult.transcript !== fullOutput) {
        fullOutput = structuredResult.transcript;
        onChunk?.(fullOutput);
      }

      const exitCode = await proc.exited;
      const stderr = sanitizeRuntimeError(await stderrPromise);

      if (cancelled) throw new AiRunCancelledError();
      if (exitCode !== 0 || structuredResult?.terminalError) {
        const errorText = sanitizeRuntimeError(structuredResult?.terminalError || stderr || fullOutput);
        if (/not authenticated|authentication required|not logged in|login required|credential(?:s)? (?:expired|required)|refresh token/i.test(errorText)) {
          throw new Error(remediationFor(provider, "unauthenticated"));
        }
        throw new Error(errorText || `${provider.name} exited with status ${exitCode}.`);
      }

      const finalOutput = fullOutput.trim();
      if (!finalOutput) {
        throw new Error(stderr || `${provider.name} returned an empty response.`);
      }

      return finalOutput;
    } catch (error) {
      try { proc?.kill(); } catch { /* ignore cleanup failures */ }
      await proc?.exited.catch(() => {});
      if (cancelled) throw new AiRunCancelledError();
      throw error;
    } finally {
      processRef = null;
      if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true }).catch(() => {});
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      try {
        processRef?.kill();
      } catch {
        // ignore cleanup failures
      }
    },
  };
}

export function runAiPrompt({
  provider,
  prompt,
  cwd,
  environment,
  onChunk,
  outputMode,
  isolatedWorkspace,
}: {
  provider: AiProvider;
  prompt: string;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  onChunk?: (output: string) => void;
  outputMode?: "plain" | "structured";
  isolatedWorkspace?: boolean;
}): AiRunController {
  return (configuredHost ?? { run: runWithBun }).run({
    provider,
    prompt,
    cwd,
    environment,
    onChunk,
    outputMode,
    isolatedWorkspace,
  });
}
