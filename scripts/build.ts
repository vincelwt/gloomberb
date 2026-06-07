import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { gzipSync } from "zlib";
import { syncVersion } from "./sync-version";

const rootDir = join(import.meta.dir, "..");

syncVersion();

interface BuildTarget {
  os: "darwin" | "linux" | "windows";
  arch: "arm64" | "x64";
  bunOs: "darwin" | "linux" | "windows";
  extension: "" | ".exe";
}

const targets: BuildTarget[] = [
  { os: "darwin", arch: "arm64", bunOs: "darwin", extension: "" },
  { os: "linux", arch: "x64", bunOs: "linux", extension: "" },
  { os: "linux", arch: "arm64", bunOs: "linux", extension: "" },
  { os: "windows", arch: "x64", bunOs: "windows", extension: ".exe" },
];

const args = process.argv.slice(2);
const buildAll = args.includes("--all");

async function runProcess(
  command: string[],
  failureMessage: string,
  options: Parameters<typeof Bun.spawn>[1] = {},
  allowFailure = false,
) {
  const proc = Bun.spawn(command, {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
    ...options,
  });
  const code = await proc.exited;
  if (code !== 0 && !allowFailure) {
    console.error(failureMessage);
    process.exit(1);
  }
  return code;
}

async function signDarwinBinary(outfile: string) {
  if (process.platform !== "darwin") {
    console.error("Failed to sign macOS binary: build darwin targets on macOS so codesign is available.");
    process.exit(1);
  }

  console.log("Signing macOS binary...");
  await runProcess(
    ["codesign", "--remove-signature", outfile],
    "",
    { stdout: "ignore", stderr: "ignore" },
    true,
  );
  await runProcess(
    ["codesign", "--force", "--sign", "-", outfile],
    `Failed to sign ${outfile}`,
  );
  await runProcess(
    ["codesign", "--verify", "--verbose=4", outfile],
    `Failed to verify signature for ${outfile}`,
  );
}

function canRunTarget(os: string, arch: string): boolean {
  const hostOs = process.platform === "darwin"
    ? "darwin"
    : process.platform === "win32"
      ? "windows"
      : process.platform === "linux"
        ? "linux"
        : process.platform;
  const hostArch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
  return hostOs === os && hostArch === arch;
}

async function smokeTestBinary(outfile: string, os: string, arch: string) {
  if (!canRunTarget(os, arch)) {
    console.log(`Skipping smoke test for ${os}-${arch} on ${process.platform}-${process.arch}`);
    return;
  }

  console.log("Smoke testing packaged binary...");
  await runProcess(
    [outfile, "help"],
    `Packaged binary failed to launch: ${outfile}`,
    { stdout: "ignore" },
  );
}

function compressGzip(path: string): string {
  const compressedPath = `${path}.gz`;
  writeFileSync(compressedPath, gzipSync(readFileSync(path), { level: 9 }));
  rmSync(path);
  return compressedPath;
}

async function build(targetConfig: BuildTarget) {
  const { os, arch, bunOs, extension } = targetConfig;
  mkdirSync(join(rootDir, "dist"), { recursive: true });
  const outfile = join(rootDir, `dist/gloomberb-${os}-${arch}${extension}`);
  const target = `bun-${bunOs}-${arch}`;
  console.log(`Building ${target}...`);
  await runProcess(
    ["bun", "build", "--compile", `--target=${target}`, "src/cli/entry.ts", `--outfile=${outfile}`],
    `Failed to build ${target}`,
    { env: { ...process.env, GLOOMBERB_API_URL: "https://api.gloom.sh" } },
  );

  if (os === "darwin") {
    await signDarwinBinary(outfile);
  }

  await smokeTestBinary(outfile, os, arch);

  const compressedPath = compressGzip(outfile);
  console.log(`  -> ${compressedPath}`);
}

if (buildAll) {
  for (const t of targets) {
    await build(t);
  }
} else {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const target = targets.find((candidate) => candidate.os === os && candidate.arch === arch);
  if (!target) {
    console.error(`Unsupported build target: ${os}-${arch}`);
    process.exit(1);
  }
  await build(target);
}
