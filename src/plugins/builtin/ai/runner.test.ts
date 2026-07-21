import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { AiProvider } from "./providers";
import { isAiRunCancelled, runAiPrompt, setAiRunHost } from "./runner";

function shellProvider(script: string): AiProvider {
  return {
    id: "codex",
    name: "Codex",
    command: "sh",
    available: true,
    buildArgs: () => ["-c", script],
    buildStructuredArgs: () => ["-c", script],
  };
}

afterEach(() => {
  setAiRunHost(null);
});

describe("AI runner", () => {
  test("passes the recovered environment to the resolved executable", async () => {
    if (process.platform === "win32") return;
    const directory = await mkdtemp(join(tmpdir(), "gloomberb-ai-runner-"));
    try {
      const interpreter = join(directory, "gloomberb-test-interpreter");
      const executable = join(directory, "fake-ai");
      await writeFile(interpreter, "#!/bin/sh\nexec /bin/sh \"$@\"\n");
      await writeFile(executable, "#!/usr/bin/env gloomberb-test-interpreter\nprintf ready\n");
      await chmod(interpreter, 0o755);
      await chmod(executable, 0o755);

      const provider: AiProvider = {
        id: "fake",
        name: "Fake",
        command: executable,
        available: true,
        status: "ready",
        buildArgs: () => [],
      };
      const run = runAiPrompt({
        provider,
        prompt: "unused",
        environment: {
          ...process.env,
          PATH: [directory, "/usr/bin", "/bin"].join(delimiter),
        },
      });

      expect(await run.done).toBe("ready");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("AI runner structured mode", () => {
  test("converts JSONL events into cumulative display transcript", async () => {
    const chunks: string[] = [];
    const provider = shellProvider(`
      printf '%s\n' '{"type":"item.completed","item":{"id":"reason","type":"reasoning","text":"hidden"}}'
      printf '%s\n' '{"type":"item.started","item":{"id":"answer","type":"agent_message","text":"Draft"}}'
      printf '%s\n' '{"type":"item.completed","item":{"id":"answer","type":"agent_message","text":"Final answer"}}'
    `);

    const run = runAiPrompt({
      provider,
      prompt: "ignored",
      outputMode: "structured",
      onChunk: (output) => chunks.push(output),
    });

    expect(await run.done).toBe("Final answer");
    expect(chunks.at(-1)).toBe("Final answer");
    expect(chunks.join(" ")).not.toContain("hidden");
  });

  test("cancellation takes precedence over process exit errors", async () => {
    const run = runAiPrompt({
      provider: shellProvider("sleep 5; exit 7"),
      prompt: "ignored",
      outputMode: "structured",
    });
    run.cancel();

    let caught: unknown;
    try {
      await run.done;
    } catch (error) {
      caught = error;
    }
    expect(isAiRunCancelled(caught)).toBe(true);
  });

  test("uses and removes an empty temporary cwd for isolated workspace runs", async () => {
    const provider = shellProvider(`printf '{"type":"item.completed","item":{"id":"answer","type":"agent_message","text":"%s"}}\\n' "$PWD"`);
    const run = runAiPrompt({
      provider,
      prompt: "ignored",
      outputMode: "structured",
      isolatedWorkspace: true,
    });

    const isolatedPath = await run.done;
    expect(isolatedPath).toContain("gloomberb-local-agent-");
    expect(existsSync(isolatedPath)).toBe(false);
  });

  test("forwards environment, structured isolation, and cancellation through a configured host", async () => {
    type RunOptions = Parameters<NonNullable<import("./runner").AiRunHost["run"]>>[0];
    const received: RunOptions[] = [];
    let cancelled = false;
    setAiRunHost({
      run(options) {
        received.push(options);
        return {
          done: Promise.resolve("host output"),
          cancel: () => { cancelled = true; },
        };
      },
    });

    const environment = { ...process.env, GLOOMBERB_AI_TEST: "ready" };
    const run = runAiPrompt({
      provider: shellProvider("unused"),
      prompt: "selected context only",
      environment,
      outputMode: "structured",
      isolatedWorkspace: true,
    });
    run.cancel();
    expect(await run.done).toBe("host output");
    expect(received[0]?.prompt).toBe("selected context only");
    expect(received[0]?.environment).toBe(environment);
    expect(received[0]?.outputMode).toBe("structured");
    expect(received[0]?.isolatedWorkspace).toBe(true);
    expect(cancelled).toBe(true);
  });
});
