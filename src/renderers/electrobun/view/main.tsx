/// <reference lib="dom" />
/** @jsxImportSource react */
import { createRoot } from "react-dom/client";
import { App } from "../../../app";
import { UiHostProvider } from "../../../ui/host";
import { debugLog } from "../../../utils/debug-log";
import { measurePerfAsync } from "../../../utils/perf-marks";
import { startMainThreadMonitor } from "../../../utils/main-thread-monitor";
import { initElectrobunBackend } from "./backend-rpc";
import { installElectrobunAiHost } from "./ai-host";
import { installElectrobunConfigStoreHost } from "./config-host";
import { WebDialogHostProvider } from "./dialog-host";
import { installElectrobunPredictionMarketsFetchTransport } from "./http-fetch";
import { WebInputHostProvider } from "./input-host";
import { webNativeRenderer } from "./native-renderer";
import { WebToastHostProvider } from "./toast-host";
import { webRendererHost, webUiHost } from "./ui-host";
import { createDesktopWindowBridge } from "./desktop-window-bridge";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}

const root = createRoot(rootElement);
const bootLog = debugLog.createLogger("electrobun-web-boot");
const ELECTROBUN_WEB_CONSOLE_LOG_SOURCES = [
  "app",
  "main-thread",
  "perf",
  "refresh-queue",
  "services",
  "startup",
  "electrobun-web-boot",
];
debugLog.mirrorToConsole({
  sources: ELECTROBUN_WEB_CONSOLE_LOG_SOURCES,
});
const stopMainThreadMonitor = startMainThreadMonitor("electrobun.web", { mirrorToConsole: true });

root.render(<div className="gloom-loading">Starting Gloomberb...</div>);
bootLog.warn("diagnostic console mirror enabled", { sources: ELECTROBUN_WEB_CONSOLE_LOG_SOURCES });

async function boot() {
  bootLog.info("boot started");
  const backendInitPromise = initElectrobunBackend();
  // Avoid a premature global unhandled-rejection render while UI chunks load.
  void backendInitPromise.catch(() => {});

  installElectrobunConfigStoreHost();
  installElectrobunPredictionMarketsFetchTransport();
  await installElectrobunAiHost();
  const init = await measurePerfAsync("startup.electrobun.backend-init", () => backendInitPromise);
  const config = init.desktopSnapshot?.config ?? init.config;
  const desktopWindowBridge = createDesktopWindowBridge(init.windowKind, init.paneId);
  measurePerfAsync("startup.electrobun.root-render", async () => {
    root.render(
      <UiHostProvider ui={webUiHost} renderer={webRendererHost} nativeRenderer={webNativeRenderer}>
        <WebInputHostProvider>
          <WebToastHostProvider>
            <WebDialogHostProvider>
              <App
                config={config}
                desktopWindowBridge={desktopWindowBridge}
                desktopSnapshot={init.desktopSnapshot}
              />
            </WebDialogHostProvider>
          </WebToastHostProvider>
        </WebInputHostProvider>
      </UiHostProvider>,
    );
  });
  bootLog.info("root render scheduled", {
    layoutPanes: config.layout.instances.length,
    floatingPanes: config.layout.floating.length,
    detachedPanes: config.layout.detached.length,
    brokerInstances: config.brokerInstances.length,
  });
}

boot().catch((error) => {
  stopMainThreadMonitor();
  root.render(
    <div className="gloom-fatal">
      <h1>Gloomberb failed to start</h1>
      <pre>{error instanceof Error ? error.stack ?? error.message : String(error)}</pre>
    </div>,
  );
});
