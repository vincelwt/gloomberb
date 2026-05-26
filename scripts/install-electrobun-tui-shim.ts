import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const SHIM = `#!/bin/sh
set -eu

SOURCE="$0"
while [ -L "$SOURCE" ]; do
  SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  case "$SOURCE" in
    /*) ;;
    *) SOURCE="$SOURCE_DIR/$SOURCE" ;;
  esac
done

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd)"
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

function nativeFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return nativeFilesIn(path);
    if (entry.isFile() && (entry.name.endsWith(".dylib") || entry.name.endsWith(".node"))) return [path];
    return [];
  });
}

function signNativeFiles(dir: string): void {
  const developerId = process.env.ELECTROBUN_DEVELOPER_ID;
  if (process.platform !== "darwin" || !developerId) return;

  for (const file of nativeFilesIn(dir)) {
    const mode = statSync(file).mode;
    chmodSync(file, mode | 0o755);

    const signed = Bun.spawnSync({
      cmd: ["codesign", "--force", "--timestamp", "--options", "runtime", "--sign", developerId, file],
      stdout: "inherit",
      stderr: "inherit",
    });

    if (signed.exitCode !== 0) {
      process.exit(signed.exitCode ?? 1);
    }
  }
}

const bundlePaths = [
  process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH,
  ...appBundlesIn(process.env.ELECTROBUN_BUILD_DIR ?? ""),
].filter((value): value is string => Boolean(value));

const uniqueBundlePaths = [...new Set(bundlePaths)];
const nativeCorePackageName = `core-${process.platform}-${process.arch}`;
const nativeCorePackagePath = join(process.cwd(), "node_modules", "@opentui", nativeCorePackageName);

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

  const nativeCoreDestPath = join(tuiBundleDir, "node_modules", "@opentui", nativeCorePackageName);
  rmSync(nativeCoreDestPath, { recursive: true, force: true });
  mkdirSync(join(tuiBundleDir, "node_modules", "@opentui"), { recursive: true });
  cpSync(nativeCorePackagePath, nativeCoreDestPath, { recursive: true, dereference: true });
  signNativeFiles(nativeCoreDestPath);

  const shimPath = join(resourcesPath, "gloomberb");
  writeFileSync(shimPath, SHIM);
  chmodSync(shimPath, 0o755);
  console.log(`Installed TUI shim: ${shimPath}`);
}
