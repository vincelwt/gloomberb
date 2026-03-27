import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import { getDataDir, initDataDir } from "./data/config-store";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { runCli } from "./cli";
import { loadExternalPlugins } from "./plugins/loader";

async function main() {
  // Handle CLI subcommands (install, remove, update, plugins)
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0) {
    const handled = await runCli(cliArgs);
    if (handled) return;
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

  // Load external plugins from ~/.gloomberb/plugins/
  const externalPlugins = await loadExternalPlugins();

  // Create renderer
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: "#000000",
  });

  // Render app
  createRoot(renderer).render(
    <App config={config} renderer={renderer} externalPlugins={externalPlugins} />
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
