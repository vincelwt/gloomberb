import { writeFileSync, renameSync, unlinkSync, chmodSync, realpathSync } from "fs";
import { basename } from "path";

const REPO = "vincelwt/gloomberb";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface ReleaseInfo {
  version: string;
  tagName: string;
  downloadUrl: string;
  publishedAt: string;
  updateAction: UpdateAction;
}

export interface UpdateProgress {
  phase: "downloading" | "replacing" | "done" | "error";
  percent?: number;
  error?: string;
}

export type UpdateAction =
  | { kind: "self" }
  | { kind: "manual"; command: string };

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getAssetName(): string {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  // macOS x64 uses arm64 binary (runs via Rosetta 2)
  const arch = os === "darwin" || process.arch === "arm64" ? "arm64" : "x64";
  return `gloomberb-${os}-${arch}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function tryRealpath(value: string): string {
  if (!value) return value;
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

function resolveEntrypointPath(argv = process.argv): string {
  return tryRealpath(argv[1] ?? "");
}

function isSourceEntrypoint(entrypoint: string): boolean {
  const sourceEntrypointPattern = /\.(c|m)?jsx?$/;
  const tsEntrypointPattern = /\.(c|m)?tsx?$/;
  return sourceEntrypointPattern.test(entrypoint) || tsEntrypointPattern.test(entrypoint);
}

export function resolveSelfUpdateTargetPath(
  execPath = process.execPath,
  argv = process.argv,
): string | null {
  const resolvedExecPath = tryRealpath(execPath);
  const normalizedExecPath = normalizePath(resolvedExecPath);
  const execBase = basename(normalizedExecPath);
  const runtimeExecutables = new Set(["bun", "bunx", "node", "nodejs", "npm", "npx", "pnpm", "yarn"]);
  if (runtimeExecutables.has(execBase)) return null;
  if (normalizedExecPath.includes("/.bun/bin/")) return null;

  const entrypoint = normalizePath(resolveEntrypointPath(argv));
  if (isSourceEntrypoint(entrypoint)) return null;

  return resolvedExecPath;
}

export function detectUpdateAction(
  execPath = process.execPath,
  argv = process.argv,
): UpdateAction | null {
  if (resolveSelfUpdateTargetPath(execPath, argv)) {
    return { kind: "self" };
  }

  const normalizedExecPath = normalizePath(tryRealpath(execPath));
  const execBase = basename(normalizedExecPath);
  const entrypoint = normalizePath(resolveEntrypointPath(argv));

  if (!entrypoint || isSourceEntrypoint(entrypoint)) return null;

  if (
    execBase === "bun"
    || execBase === "bunx"
    || normalizedExecPath.includes("/.bun/bin/")
    || entrypoint.includes("/.bun/install/")
    || entrypoint.includes("/install/global/")
  ) {
    return { kind: "manual", command: "bun install -g gloomberb@latest" };
  }

  if (
    execBase === "node"
    || execBase === "nodejs"
    || execBase === "npm"
    || execBase === "npx"
    || execBase === "pnpm"
    || execBase === "yarn"
    || entrypoint.includes("/lib/node_modules/")
    || entrypoint.includes("/node_modules/")
  ) {
    return { kind: "manual", command: "npm install -g gloomberb@latest" };
  }

  return null;
}

export function canSelfUpdate(release: Pick<ReleaseInfo, "updateAction"> | null | undefined): boolean {
  return release?.updateAction.kind === "self";
}

export async function checkForUpdate(
  currentVersion: string,
): Promise<ReleaseInfo | null> {
  const updateAction = detectUpdateAction();
  if (!updateAction) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(API_URL, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as {
      tag_name: string;
      published_at: string;
      assets: { name: string; browser_download_url: string }[];
    };

    const version = data.tag_name.replace(/^v/, "");
    if (compareSemver(version, currentVersion) <= 0) return null;

    const assetName = getAssetName();
    const asset = data.assets.find((a) => a.name === assetName);
    if (!asset) return null;

    return {
      version,
      tagName: data.tag_name,
      downloadUrl: asset.browser_download_url,
      publishedAt: data.published_at,
      updateAction,
    };
  } catch {
    return null;
  }
}

export async function performUpdate(
  release: ReleaseInfo,
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  if (!canSelfUpdate(release)) {
    onProgress({
      phase: "error",
      error: `Run ${release.updateAction.command}`,
    });
    return;
  }

  const execPath = resolveSelfUpdateTargetPath();
  if (!execPath) {
    onProgress({
      phase: "error",
      error: "Self-update is unavailable when running from source or via Bun/Node. Relaunch the packaged gloomberb binary to update.",
    });
    return;
  }

  const updatePath = execPath + ".update";
  const oldPath = execPath + ".old";

  try {
    onProgress({ phase: "downloading", percent: 0 });

    const res = await fetch(release.downloadUrl);
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: ${res.status}`);
    }

    const contentLength = Number(res.headers.get("content-length") || 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) {
        onProgress({
          phase: "downloading",
          percent: Math.round((received / contentLength) * 100),
        });
      }
    }

    // Write to temp file
    const blob = new Blob(chunks);
    const buffer = await blob.arrayBuffer();
    writeFileSync(updatePath, Buffer.from(buffer));
    chmodSync(updatePath, 0o755);

    // Swap binaries
    onProgress({ phase: "replacing" });
    try {
      unlinkSync(oldPath);
    } catch {}
    renameSync(execPath, oldPath);
    renameSync(updatePath, execPath);
    try {
      unlinkSync(oldPath);
    } catch {}

    onProgress({ phase: "done" });
  } catch (err: unknown) {
    // Clean up temp file on failure
    try {
      unlinkSync(updatePath);
    } catch {}
    onProgress({
      phase: "error",
      error: err instanceof Error ? err.message : "Update failed",
    });
  }
}
