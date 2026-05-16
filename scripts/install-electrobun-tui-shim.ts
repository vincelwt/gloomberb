import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const SHIM = `#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CONTENTS_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CONTENTS_DIR/MacOS"
exec "./bun" "$CONTENTS_DIR/Resources/gloomberb-tui/tui-entry.js" "$@"
`;

function appBundlesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".app"))
    .map((entry) => join(dir, entry));
}

const bundlePaths = [
  process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH,
  ...appBundlesIn(process.env.ELECTROBUN_BUILD_DIR ?? ""),
].filter((value): value is string => Boolean(value));

const uniqueBundlePaths = [...new Set(bundlePaths)];

for (const bundlePath of uniqueBundlePaths) {
  const resourcesPath = join(bundlePath, "Contents", "Resources");
  if (!existsSync(resourcesPath)) continue;

  const tuiBundleDir = join(resourcesPath, "gloomberb-tui");
  rmSync(tuiBundleDir, { recursive: true, force: true });
  mkdirSync(tuiBundleDir, { recursive: true });

  const build = Bun.spawnSync({
    cmd: [
      process.execPath,
      "build",
      join(process.cwd(), "src", "renderers", "electrobun", "bun", "tui-entry.ts"),
      "--target=bun",
      `--outdir=${tuiBundleDir}`,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  if (build.exitCode !== 0) {
    process.exit(1);
  }

  const shimPath = join(resourcesPath, "gloomberb");
  writeFileSync(shimPath, SHIM);
  chmodSync(shimPath, 0o755);
  console.log(`Installed TUI shim: ${shimPath}`);
}
