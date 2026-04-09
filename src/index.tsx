import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import { getDataDir, initDataDir } from "./data/config-store";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { dispatchCli } from "./cli/index";
import { loadExternalPlugins } from "./plugins/loader";
import { debugLog } from "./utils/debug-log";
import { resetTerminalInputState } from "./utils/terminal-input-reset";

async function main() {
  // Intercept console.log/warn/error to capture in debug log
  debugLog.interceptConsole();

  const appLog = debugLog.createLogger("app");
  appLog.info("Gloomberb starting");

  // Handle CLI subcommands (install, remove, update, plugins)
  const cliArgs = process.argv.slice(2);
  const externalPlugins = await loadExternalPlugins();
  let cliLaunchRequest = null;
  if (cliArgs.length > 0) {
    const dispatchResult = await dispatchCli(cliArgs, { externalPlugins });
    if (dispatchResult.kind === "handled") return;
    if (dispatchResult.kind === "launch-ui") {
      cliLaunchRequest = dispatchResult.request;
    }
  }

  // Determine data directory
  let dataDir = await getDataDir();

  if (!dataDir) {
    // First run - use default location
    dataDir = join(process.env.HOME || "~", ".gloomberb");
  }

  // Ensure data dir exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Load or create config
  const config = await initDataDir(dataDir);

  // `bun run --watch` does not guarantee the previous run's renderer can cleanly
  // restore mouse/raw terminal modes before the next run starts.
  resetTerminalInputState();

  // Create renderer
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: "#000000",
    enableMouseMovement: true,
  });

  // Render app
  createRoot(renderer).render(
    <App
      config={config}
      renderer={renderer}
      externalPlugins={externalPlugins}
      cliLaunchRequest={cliLaunchRequest}
    />
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
