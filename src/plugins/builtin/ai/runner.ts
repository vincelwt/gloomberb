import type { AiProvider } from "./providers";

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
    onChunk?: (output: string) => void;
  }): AiRunController;
}

let configuredHost: AiRunHost | null = null;

export function setAiRunHost(host: AiRunHost | null): void {
  configuredHost = host;
}

export function isAiRunCancelled(error: unknown): boolean {
  return error instanceof AiRunCancelledError;
}

function runWithBun({
  provider,
  prompt,
  cwd = typeof process !== "undefined" ? process.cwd() : ".",
  onChunk,
}: {
  provider: AiProvider;
  prompt: string;
  cwd?: string;
  onChunk?: (output: string) => void;
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
    const proc = Bun.spawn([provider.command, ...provider.buildArgs(prompt)], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    processRef = proc;

    const stderrPromise = new Response(proc.stderr).text().catch(() => "");
    const stdoutReader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let fullOutput = "";

    while (true) {
      const { done: streamDone, value } = await stdoutReader.read();
      if (streamDone) break;
      if (cancelled) throw new AiRunCancelledError();
      fullOutput += decoder.decode(value, { stream: true });
      onChunk?.(fullOutput);
    }

    const exitCode = await proc.exited;
    const stderr = (await stderrPromise).trim();

    if (cancelled) throw new AiRunCancelledError();
    if (exitCode !== 0) {
      throw new Error(stderr || fullOutput.trim() || `${provider.name} exited with status ${exitCode}.`);
    }

    const finalOutput = fullOutput.trim();
    if (!finalOutput) {
      throw new Error(stderr || `${provider.name} returned an empty response.`);
    }

    return finalOutput;
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
  onChunk,
}: {
  provider: AiProvider;
  prompt: string;
  cwd?: string;
  onChunk?: (output: string) => void;
}): AiRunController {
  return (configuredHost ?? { run: runWithBun }).run({ provider, prompt, cwd, onChunk });
}
