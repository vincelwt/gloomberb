import { describe, expect, test } from "bun:test";
import { delimiter } from "path";
import { discoverAiCliProviders, resolveAiCliSearchPath } from "./cli-readiness";

describe("AI CLI readiness", () => {
  test("recovers GUI paths and verifies providers without sending prompts", async () => {
    const userBin = "/Users/test/.local/bin";
    const basePath = ["/usr/bin", "/bin"].join(delimiter);
    const recoveredPath = [userBin, basePath].join(delimiter);
    const commands: string[][] = [];

    const providers = await discoverAiCliProviders({
      env: { HOME: "/Users/test", PATH: basePath, SHELL: "/bin/zsh" },
      homeDir: "/Users/test",
      platform: "darwin",
      recoverLoginShellPath: true,
      loadLoginShellEnvironment: async () => ({
        PATH: recoveredPath,
        GEMINI_API_KEY: "configured-in-login-shell",
      }),
      which: (command, searchPath) => (
        searchPath.includes(userBin) ? `${userBin}/${command}` : null
      ),
      runCommand: async (executable, args, options) => {
        commands.push([executable, ...args]);
        expect(options.env.PATH).toContain(userBin);
        expect(options.env.GEMINI_API_KEY).toBe("configured-in-login-shell");
        return executable.endsWith("/claude")
          ? { exitCode: 0, stdout: '{"loggedIn":true}', stderr: "" }
          : { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(providers.map(({ provider }) => ({
      id: provider.id,
      available: provider.available,
      command: provider.command,
    }))).toEqual([
      { id: "claude", available: true, command: `${userBin}/claude` },
      { id: "gemini", available: true, command: `${userBin}/gemini` },
      { id: "codex", available: true, command: `${userBin}/codex` },
      { id: "pi", available: true, command: `${userBin}/pi` },
    ]);
    expect(commands).toEqual([
      [`${userBin}/claude`, "auth", "status", "--json"],
      [`${userBin}/gemini`, "--list-extensions"],
      [`${userBin}/codex`, "login", "status"],
    ]);
  });

  test("distinguishes missing commands from installed but logged-out commands", async () => {
    const providers = await discoverAiCliProviders({
      searchPath: "/tools",
      platform: "darwin",
      homeDir: "/Users/test",
      which: (command) => command === "gemini" ? null : `/tools/${command}`,
      runCommand: async (executable) => executable.endsWith("/claude")
        ? { exitCode: 0, stdout: '{"loggedIn":false}', stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "Not logged in" },
    });

    expect(providers.map(({ provider }) => [provider.id, provider.status])).toEqual([
      ["claude", "not_authenticated"],
      ["gemini", "missing"],
      ["codex", "not_authenticated"],
      ["pi", "ready"],
    ]);
    expect(providers.filter(({ provider }) => provider.id !== "pi").every(({ provider }) => !provider.available)).toBe(true);
  });

  test("falls back to common user install directories when shell startup fails", async () => {
    const searchPath = await resolveAiCliSearchPath({
      searchPath: ["/usr/bin", "/bin"].join(delimiter),
      platform: "darwin",
      homeDir: "/Users/test",
      recoverLoginShellPath: true,
      loadLoginShellEnvironment: async () => {
        throw new Error("broken shell profile");
      },
    });

    expect(searchPath.split(delimiter)).toEqual(expect.arrayContaining([
      "/Users/test/.local/bin",
      "/Users/test/.bun/bin",
      "/Users/test/.npm-global/bin",
      "/Users/test/.claude/local",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
    ]));
    expect(searchPath.split(delimiter).filter((entry) => entry === "/usr/bin")).toHaveLength(1);
  });

  test("finds Windows user-local and npm-installed CLIs", async () => {
    const searchPath = await resolveAiCliSearchPath({
      env: {
        PATH: "C:\\Windows\\System32",
        USERPROFILE: "C:\\Users\\example",
        APPDATA: "C:\\Users\\example\\AppData\\Roaming",
      },
      homeDir: "C:\\Users\\example",
      platform: "win32",
    });

    expect(searchPath.split(";")).toEqual(expect.arrayContaining([
      "C:\\Users\\example\\.local\\bin",
      "C:\\Users\\example\\.bun\\bin",
      "C:\\Users\\example\\AppData\\Roaming\\npm",
      "C:\\Windows\\System32",
    ]));
  });
});
