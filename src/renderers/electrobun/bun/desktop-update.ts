import Electrobun from "electrobun/bun";
import type { UpdateStatusEntry } from "electrobun/bun";
import type {
  ReleaseInfo,
  UpdateCheckResult,
  UpdateProgress,
} from "../../../updater";

let desktopUpdateInProgress = false;

function desktopReleasePlatformPrefix(channel: string): string {
  const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "win" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${channel}-${os}-${arch}`;
}

async function desktopReleaseInfo(updateInfo: {
  version?: string;
  hash?: string;
}, currentVersion: string): Promise<ReleaseInfo> {
  const [channel, baseUrl] = await Promise.all([
    Electrobun.Updater.localInfo.channel(),
    Electrobun.Updater.localInfo.baseUrl(),
  ]);
  const version = updateInfo.version || currentVersion;
  return {
    version,
    tagName: `v${version}`,
    downloadUrl: `${baseUrl.replace(/\/+$/, "")}/${desktopReleasePlatformPrefix(channel)}-update.json`,
    publishedAt: "",
    updateAction: { kind: "desktop" },
  };
}

function mapDesktopUpdateStatus(entry: UpdateStatusEntry): UpdateProgress | null {
  const progress = entry.details?.progress;
  switch (entry.status) {
    case "downloading":
    case "download-starting":
    case "checking-local-tar":
    case "local-tar-found":
    case "local-tar-missing":
    case "fetching-patch":
    case "patch-found":
    case "patch-not-found":
    case "downloading-patch":
    case "downloading-full-bundle":
    case "download-progress":
      return {
        phase: "downloading",
        percent: typeof progress === "number" ? progress : undefined,
      };
    case "applying-patch":
    case "patch-applied":
    case "extracting-version":
    case "patch-chain-complete":
    case "decompressing":
    case "download-complete":
    case "applying":
    case "extracting":
    case "replacing-app":
    case "launching-new-version":
      return { phase: "replacing" };
    case "complete":
      return { phase: "done", message: "Update installed, restarting..." };
    case "error":
      return {
        phase: "error",
        error: entry.details?.errorMessage || entry.message,
      };
    default:
      return null;
  }
}

export async function checkElectrobunDesktopUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    const [channel, baseUrl] = await Promise.all([
      Electrobun.Updater.localInfo.channel(),
      Electrobun.Updater.localInfo.baseUrl(),
    ]);
    if (channel === "dev" || !baseUrl) {
      return { kind: "disabled" };
    }

    const info = await Electrobun.Updater.checkForUpdate();
    if (info.error) {
      return { kind: "error", error: info.error };
    }
    if (!info.updateAvailable) {
      return { kind: "current" };
    }

    return {
      kind: "available",
      release: await desktopReleaseInfo(info, currentVersion),
    };
  } catch (error) {
    return {
      kind: "error",
      error: error instanceof Error ? error.message : "Desktop update check failed",
    };
  }
}

export async function runElectrobunDesktopUpdate(
  currentVersion: string,
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  if (desktopUpdateInProgress) {
    onProgress({
      phase: "error",
      error: "A desktop update is already in progress.",
    });
    return;
  }

  desktopUpdateInProgress = true;
  Electrobun.Updater.clearStatusHistory();
  Electrobun.Updater.onStatusChange((entry) => {
    const progress = mapDesktopUpdateStatus(entry);
    if (progress) onProgress(progress);
  });

  try {
    onProgress({ phase: "downloading", percent: 0 });
    const result = await checkElectrobunDesktopUpdate(currentVersion);
    if (result.kind === "error") {
      onProgress({ phase: "error", error: result.error });
      return;
    }
    if (result.kind !== "available") {
      onProgress({
        phase: "done",
        message: result.kind === "disabled" ? "Desktop updates are unavailable in this build" : "Already on the latest version",
      });
      return;
    }

    await Electrobun.Updater.downloadUpdate();
    const updateInfo = Electrobun.Updater.updateInfo();
    if (updateInfo?.error) {
      onProgress({ phase: "error", error: updateInfo.error });
      return;
    }
    if (!updateInfo?.updateReady) {
      onProgress({ phase: "error", error: "Desktop update did not finish downloading." });
      return;
    }

    onProgress({ phase: "replacing" });
    await Electrobun.Updater.applyUpdate();
  } catch (error) {
    onProgress({
      phase: "error",
      error: error instanceof Error ? error.message : "Desktop update failed",
    });
  } finally {
    desktopUpdateInProgress = false;
    Electrobun.Updater.onStatusChange(null);
  }
}
