import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { App } from "../../app";
import { dispatchCli } from "../../cli/index";
import { getDataDir, initDataDir, setConfigStoreHost } from "../../data/config/store";
import * as nodeConfigStoreHost from "../../data/config/store/node";
import { loadExternalPlugins } from "../../plugins/loader";
import { OpenTuiInputHostProvider } from "./input-host";
import { debugLog } from "../../utils/debug-log";
import { UiHostProvider } from "../../ui/host";
import { createOpenTuiHost } from "./host";
import { openTuiUiHost } from "./ui-host";
import { OpenTuiDialogHostProvider } from "./dialog-host";
import { openTuiToastHost } from "./toast-host";
import { ToastHostProvider } from "../../ui/toast";
import { colors } from "../../theme/colors";
import { startMainThreadMonitor } from "../../utils/main-thread-monitor";
import { measurePerfAsync } from "../../utils/perf-marks";
import type { CliLaunchRequest } from "../../types/plugin";

export interface StartOpenTuiAppOptions {
  externalPlugins?: Awaited<ReturnType<typeof loadExternalPlugins>>;
  cliArgs?: string[];
  skipCliDispatch?: boolean;
  cliLaunchRequest?: CliLaunchRequest | null;
}

export async function startOpenTuiApp(options: StartOpenTuiAppOptions = {}): Promise<void> {
  setConfigStoreHost(nodeConfigStoreHost);
  debugLog.interceptConsole();

  const appLog = debugLog.createLogger("app");
  appLog.info("Gloomberb starting");

  const cliArgs = options.cliArgs ?? process.argv.slice(2);
  const externalPlugins = options.externalPlugins ?? await measurePerfAsync("startup.opentui.load-external-plugins", () => loadExternalPlugins());
  let cliLaunchRequest = options.cliLaunchRequest ?? null;
  if (!options.skipCliDispatch && cliArgs.length > 0) {
    const dispatchResult = await dispatchCli(cliArgs, { externalPlugins });
    if (dispatchResult.kind === "handled") return;
    if (dispatchResult.kind === "launch-ui") {
      cliLaunchRequest = dispatchResult.request;
    }
  }
  const stopMainThreadMonitor = startMainThreadMonitor("opentui");

  let host: Awaited<ReturnType<typeof createOpenTuiHost>> | null = null;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;
  const finishProcessExit = () => {
    stopMainThreadMonitor();
    if (exitTimer) return;
    exitTimer = setTimeout(() => {
      process.exit(process.exitCode ?? 0);
    }, 0);
  };
  try {
    let dataDir = await getDataDir();
    if (!dataDir) {
      dataDir = join(process.env.HOME || "~", ".gloomberb");
    }

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const config = await measurePerfAsync("startup.opentui.init-data-dir", () => initDataDir(dataDir));
    host = await measurePerfAsync("startup.opentui.create-host", () => createOpenTuiHost());
    host.renderer.once("destroy", finishProcessExit);

    host.render(
      <UiHostProvider ui={openTuiUiHost} renderer={host.rendererHost} nativeRenderer={host.nativeRenderer}>
        <OpenTuiInputHostProvider>
          <ToastHostProvider host={openTuiToastHost}>
            <OpenTuiDialogHostProvider
              size="medium"
              dialogOptions={{ style: { backgroundColor: colors.bg, borderColor: colors.borderFocused, borderStyle: "single", paddingX: 2, paddingY: 1 } }}
              backdropColor={colors.bg}
              backdropOpacity={0.8}
            >
              <App
                config={config}
                externalPlugins={externalPlugins}
                cliLaunchRequest={cliLaunchRequest}
              />
            </OpenTuiDialogHostProvider>
          </ToastHostProvider>
        </OpenTuiInputHostProvider>
      </UiHostProvider>,
    );
  } catch (error) {
    if (exitTimer) clearTimeout(exitTimer);
    stopMainThreadMonitor();
    host?.renderer.off("destroy", finishProcessExit);
    host?.destroy();
    throw error;
  }
}
