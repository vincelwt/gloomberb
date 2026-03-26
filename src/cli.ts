import { join } from "path";
import { existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { getPluginsDir } from "./plugins/loader";

const PLUGINS_DIR = getPluginsDir();

function ensurePluginsDir() {
  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

/** Parse a GitHub reference into a clone URL and directory name */
function parseGitHubRef(ref: string): { url: string; name: string } {
  // Full URL: https://github.com/user/repo or https://github.com/user/repo.git
  if (ref.startsWith("https://github.com/")) {
    const clean = ref.replace(/\.git$/, "");
    const name = clean.split("/").pop()!;
    return { url: clean.endsWith(".git") ? ref : `${clean}.git`, name };
  }
  // github: prefix
  if (ref.startsWith("github:")) {
    ref = ref.slice(7);
  }
  // user/repo format
  if (ref.includes("/") && !ref.includes("://")) {
    const name = ref.split("/").pop()!;
    return { url: `https://github.com/${ref}.git`, name };
  }
  throw new Error(`Invalid plugin reference: ${ref}. Use user/repo or a GitHub URL.`);
}

async function install(ref: string) {
  ensurePluginsDir();
  const { url, name } = parseGitHubRef(ref);
  const targetDir = join(PLUGINS_DIR, name);

  if (existsSync(targetDir)) {
    console.log(`Plugin "${name}" already installed at ${targetDir}`);
    console.log(`Use "gloomberb update ${name}" to update it.`);
    process.exit(1);
  }

  console.log(`Installing ${name} from ${url}...`);
  try {
    execSync(`git clone --depth 1 ${url} ${targetDir}`, { stdio: "inherit" });
  } catch {
    console.error(`Failed to clone ${url}`);
    process.exit(1);
  }

  // Install dependencies if package.json exists
  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    console.log("Installing dependencies...");
    try {
      execSync("bun install", { cwd: targetDir, stdio: "inherit" });
    } catch {
      console.error("Warning: Failed to install dependencies");
    }
  }

  // Validate the plugin
  try {
    let entryFile: string | null = null;
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await Bun.file(pkgPath).text());
      if (pkg.main) entryFile = join(targetDir, pkg.main);
    }
    if (!entryFile) {
      for (const c of ["index.ts", "index.tsx", "index.js"]) {
        const p = join(targetDir, c);
        if (existsSync(p)) { entryFile = p; break; }
      }
    }
    if (entryFile) {
      const mod = await import(entryFile);
      const plugin = mod.default ?? mod.plugin;
      if (plugin?.id && plugin?.name) {
        console.log(`\nInstalled ${plugin.name} v${plugin.version || "0.0.0"}`);
        return;
      }
    }
    console.log(`\nWarning: No valid GloomPlugin export found, but files were installed.`);
  } catch (err) {
    console.log(`\nWarning: Plugin validation failed: ${err}`);
    console.log("Files were installed but the plugin may not load correctly.");
  }
}

async function remove(name: string) {
  const targetDir = join(PLUGINS_DIR, name);
  if (!existsSync(targetDir)) {
    console.error(`Plugin "${name}" not found in ${PLUGINS_DIR}`);
    process.exit(1);
  }
  rmSync(targetDir, { recursive: true, force: true });
  console.log(`Removed plugin "${name}"`);
}

async function update(name?: string) {
  ensurePluginsDir();
  const dirs = name
    ? [name]
    : readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  if (dirs.length === 0) {
    console.log("No plugins installed.");
    return;
  }

  for (const dir of dirs) {
    const targetDir = join(PLUGINS_DIR, dir);
    if (!existsSync(join(targetDir, ".git"))) {
      console.log(`Skipping ${dir} (not a git repo)`);
      continue;
    }
    console.log(`Updating ${dir}...`);
    try {
      execSync("git pull", { cwd: targetDir, stdio: "inherit" });
      const pkgPath = join(targetDir, "package.json");
      if (existsSync(pkgPath)) {
        execSync("bun install", { cwd: targetDir, stdio: "inherit" });
      }
    } catch {
      console.error(`Failed to update ${dir}`);
    }
  }
}

function list() {
  ensurePluginsDir();
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  if (entries.length === 0) {
    console.log("No plugins installed.");
    console.log(`\nInstall plugins with: gloomberb install <github-user/repo>`);
    return;
  }

  console.log("Installed plugins:\n");
  for (const entry of entries) {
    const dir = join(PLUGINS_DIR, entry.name);
    let info = entry.name;
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(require("fs").readFileSync(pkgPath, "utf-8"));
        if (pkg.version) info += ` v${pkg.version}`;
        if (pkg.description) info += ` - ${pkg.description}`;
      } catch { /* ignore */ }
    }
    console.log(`  ${info}`);
  }
  console.log(`\nPlugin directory: ${PLUGINS_DIR}`);
}

export async function runCli(args: string[]): Promise<boolean> {
  const command = args[0];

  switch (command) {
    case "install": {
      const ref = args[1];
      if (!ref) {
        console.error("Usage: gloomberb install <github-user/repo>");
        process.exit(1);
      }
      await install(ref);
      return true;
    }
    case "remove":
    case "uninstall": {
      const name = args[1];
      if (!name) {
        console.error("Usage: gloomberb remove <plugin-name>");
        process.exit(1);
      }
      await remove(name);
      return true;
    }
    case "update": {
      await update(args[1]);
      return true;
    }
    case "plugins":
    case "list": {
      list();
      return true;
    }
    default:
      return false;
  }
}
