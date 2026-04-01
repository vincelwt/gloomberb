import { spawn, type Subprocess } from "bun";
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

export function isAiRunCancelled(error: unknown): boolean {
  return error instanceof AiRunCancelledError;
}

export function runAiPrompt({
  provider,
  prompt,
  cwd = process.cwd(),
  onChunk,
}: {
  provider: AiProvider;
  prompt: string;
  cwd?: string;
  onChunk?: (output: string) => void;
}): AiRunController {
  let cancelled = false;
  let processRef: Subprocess | null = null;

  const done = (async () => {
    const proc = spawn([provider.command, ...provider.buildArgs(prompt)], {
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
