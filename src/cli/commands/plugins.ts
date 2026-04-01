import { join } from "path";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import { getPluginsDir } from "../../plugins/loader";
import {
  cliStyles,
  renderSection,
  renderStat,
  renderTable,
} from "../../utils/cli-output";
import { fail } from "../errors";

const PLUGINS_DIR = getPluginsDir();

function ensurePluginsDir() {
  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

function parseGitHubRef(ref: string): { url: string; name: string } {
  if (ref.startsWith("https://github.com/")) {
    const clean = ref.replace(/\.git$/, "");
    const name = clean.split("/").pop()!;
    return { url: clean.endsWith(".git") ? ref : `${clean}.git`, name };
  }
  if (ref.startsWith("github:")) {
    ref = ref.slice(7);
  }
  if (ref.includes("/") && !ref.includes("://")) {
    const name = ref.split("/").pop()!;
    return { url: `https://github.com/${ref}.git`, name };
  }
  throw new Error(`Invalid plugin reference: ${ref}. Use user/repo or a GitHub URL.`);
}

export async function installPlugin(ref: string) {
  ensurePluginsDir();
  const { url, name } = parseGitHubRef(ref);
  const targetDir = join(PLUGINS_DIR, name);

  if (existsSync(targetDir)) {
    fail(`Plugin "${name}" already exists.`, `Use "gloomberb update ${name}" to refresh it.`);
  }

  console.log(cliStyles.accent(`Installing ${name}`));
  console.log(cliStyles.muted(url));

  try {
    execSync(`git clone --depth 1 ${url} ${targetDir}`, { stdio: "inherit" });
  } catch {
    fail(`Failed to clone ${url}.`);
  }

  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    console.log(cliStyles.muted("Installing plugin dependencies..."));
    try {
      execSync("bun install", { cwd: targetDir, stdio: "inherit" });
    } catch {
      console.error(cliStyles.warning("Warning: failed to install plugin dependencies."));
    }
  }

  try {
    let entryFile: string | null = null;
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await Bun.file(pkgPath).text());
      if (pkg.main) entryFile = join(targetDir, pkg.main);
    }
    if (!entryFile) {
      for (const candidate of ["index.ts", "index.tsx", "index.js"]) {
        const path = join(targetDir, candidate);
        if (existsSync(path)) {
          entryFile = path;
          break;
        }
      }
    }
    if (entryFile) {
      const mod = await import(entryFile);
      const plugin = mod.default ?? mod.plugin;
      if (plugin?.id && plugin?.name) {
        console.log(cliStyles.success(`Installed ${plugin.name} v${plugin.version || "0.0.0"}`));
        return;
      }
    }
    console.log(cliStyles.warning("Installed files, but no valid GloomPlugin export was found."));
  } catch (err) {
    console.log(cliStyles.warning(`Plugin validation failed: ${err}`));
  }
}

export async function removePlugin(name: string) {
  const targetDir = join(PLUGINS_DIR, name);
  if (!existsSync(targetDir)) {
    fail(`Plugin "${name}" was not found.`, PLUGINS_DIR);
  }
  rmSync(targetDir, { recursive: true, force: true });
  console.log(cliStyles.success(`Removed plugin "${name}".`));
}

export async function updatePlugins(name?: string) {
  ensurePluginsDir();
  const dirs = name
    ? [name]
    : readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

  if (dirs.length === 0) {
    console.log(cliStyles.muted("No plugins installed."));
    return;
  }

  for (const dir of dirs) {
    const targetDir = join(PLUGINS_DIR, dir);
    if (!existsSync(join(targetDir, ".git"))) {
      console.log(cliStyles.warning(`Skipping ${dir} (not a git repo)`));
      continue;
    }
    console.log(cliStyles.accent(`Updating ${dir}...`));
    try {
      execSync("git pull", { cwd: targetDir, stdio: "inherit" });
      const pkgPath = join(targetDir, "package.json");
      if (existsSync(pkgPath)) {
        execSync("bun install", { cwd: targetDir, stdio: "inherit" });
      }
    } catch {
      console.error(cliStyles.danger(`Failed to update ${dir}.`));
    }
  }
}

export function listPlugins() {
  ensurePluginsDir();
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  if (entries.length === 0) {
    console.log(cliStyles.muted("No plugins installed."));
    console.log(cliStyles.muted("Install one with: gloomberb install <github-user/repo>"));
    return;
  }

  const rows = entries.map((entry) => {
    const dir = join(PLUGINS_DIR, entry.name);
    let version = "—";
    let description = "—";
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        version = pkg.version || "—";
        description = pkg.description || "—";
      } catch {
        description = "Unreadable package.json";
      }
    }
    return [entry.name, version, description];
  });

  console.log(renderSection("Installed Plugins"));
  console.log(renderTable(
    [
      { header: "Plugin" },
      { header: "Version" },
      { header: "Description" },
    ],
    rows,
  ));
  console.log("");
  console.log(renderStat("Directory", PLUGINS_DIR));
}
