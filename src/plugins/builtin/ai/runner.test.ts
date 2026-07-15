import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import type { AiProvider } from "./providers";
import { runAiPrompt, setAiRunHost } from "./runner";

afterEach(() => {
  setAiRunHost(null);
});

describe("AI runner", () => {
  test("passes the recovered PATH to executables that use env shebangs", async () => {
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
