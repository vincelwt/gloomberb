import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const rootDir = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const version = pkg.version;

// Sync version into generated files
writeFileSync(
  join(rootDir, "src/version.ts"),
  `export const VERSION = "${version}";\n`,
);

// Sync npm wrapper package version
const npmPkgPath = join(rootDir, "npm/package.json");
const npmPkg = JSON.parse(readFileSync(npmPkgPath, "utf-8"));
npmPkg.version = version;
writeFileSync(npmPkgPath, JSON.stringify(npmPkg, null, 2) + "\n");

const targets = [
  { os: "darwin", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
];

const args = process.argv.slice(2);
const buildAll = args.includes("--all");

async function build(os: string, arch: string) {
  const outfile = join(rootDir, `dist/gloomberb-${os}-${arch}`);
  const target = `bun-${os}-${arch}`;
  console.log(`Building ${target}...`);
  const proc = Bun.spawn(
    ["bun", "build", "--compile", `--target=${target}`, "src/index.tsx", `--outfile=${outfile}`],
    { cwd: rootDir, stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`Failed to build ${target}`);
    process.exit(1);
  }
  console.log(`  -> ${outfile}`);
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
