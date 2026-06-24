import { existsSync } from "fs";
import { join } from "path";

const rootDir = join(import.meta.dir, "..");
const electrobunBin = join(rootDir, "node_modules", "electrobun", "bin", process.platform === "win32" ? "electrobun.exe" : "electrobun");

async function run(command: string[], options: { allowFailure?: boolean; stdout?: "inherit" | "ignore"; stderr?: "inherit" | "ignore" } = {}) {
  const proc = Bun.spawn(command, {
    cwd: rootDir,
    stdout: options.stdout ?? "inherit",
    stderr: options.stderr ?? "inherit",
  });
  const code = await proc.exited;
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command.join(" ")} failed with exit code ${code}`);
  }
  return code;
}

async function ensureMacExecutableSignature(path: string) {
  if (process.platform !== "darwin") return;
  await run(["codesign", "--force", "--sign", "-", path]);
}

if (!existsSync(electrobunBin)) {
  throw new Error(`Electrobun CLI not found at ${electrobunBin}. Run bun install first.`);
}

await ensureMacExecutableSignature(electrobunBin);

const proc = Bun.spawn([electrobunBin, "dev", "--watch"], {
  cwd: rootDir,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});
const code = await proc.exited;
if (proc.signalCode) {
  console.error(`electrobun dev exited from signal ${proc.signalCode}`);
  process.exit(1);
}
process.exit(code);
