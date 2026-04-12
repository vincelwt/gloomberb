import { join } from "path";
import { syncVersion } from "./sync-version";

const rootDir = join(import.meta.dir, "..");

syncVersion();


const targets = [
  { os: "darwin", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
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
  const hostOs = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform;
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

async function build(os: string, arch: string) {
  const outfile = join(rootDir, `dist/gloomberb-${os}-${arch}`);
  const target = `bun-${os}-${arch}`;
  console.log(`Building ${target}...`);
  await runProcess(
    ["bun", "build", "--compile", `--target=${target}`, "src/index.tsx", `--outfile=${outfile}`],
    `Failed to build ${target}`,
    { env: { ...process.env, GLOOMBERB_API_URL: "https://api.gloom.sh" } },
  );

  if (os === "darwin") {
    await signDarwinBinary(outfile);
  }

  await smokeTestBinary(outfile, os, arch);

  // Compress with gzip
  await runProcess(["gzip", "-f", "-9", outfile], `Failed to compress ${outfile}`);
  console.log(`  -> ${outfile}.gz`);
}

if (buildAll) {
  for (const t of targets) {
    await build(t.os, t.arch);
  }
} else {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  await build(os, arch);
}
