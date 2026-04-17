/// <reference lib="dom" />
/** @jsxImportSource react */
import { createRoot } from "react-dom/client";
import { debugLog } from "../../../utils/debug-log";
import { measurePerfAsync } from "../../../utils/perf-marks";
import { startMainThreadMonitor } from "../../../utils/main-thread-monitor";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}

const root = createRoot(rootElement);
const bootLog = debugLog.createLogger("tauri-web-boot");
const TAURI_WEB_CONSOLE_LOG_SOURCES = [
  "app",
  "main-thread",
  "perf",
  "refresh-queue",
  "services",
  "startup",
  "tauri-web-boot",
];
debugLog.mirrorToConsole({
  sources: TAURI_WEB_CONSOLE_LOG_SOURCES,
});
const stopMainThreadMonitor = startMainThreadMonitor("tauri.web", { mirrorToConsole: true });

root.render(<div className="gloom-loading">Starting Gloomberb...</div>);
bootLog.warn("diagnostic console mirror enabled", { sources: TAURI_WEB_CONSOLE_LOG_SOURCES });

async function boot() {
  bootLog.info("boot started");
  const backendModulePromise = import("./backend-rpc");
  const backendInitPromise = backendModulePromise.then(({ initTauriBackend }) => initTauriBackend());
  // Avoid a premature global unhandled-rejection render while UI chunks load.
  void backendInitPromise.catch(() => {});

  const [
    { App },
    { UiHostProvider },
    { WebDialogHostProvider },
    { installTauriConfigStoreHost },
    { installTauriPredictionMarketsFetchTransport },
    { WebInputHostProvider },
    { webNativeRenderer },
    { WebToastHostProvider },
    { webRendererHost, webUiHost },
  ] = await measurePerfAsync("startup.tauri.import-ui", () => Promise.all([
    import("../../../app"),
    import("../../../ui/host"),
    import("./dialog-host"),
    import("./config-host"),
    import("./http-fetch"),
    import("./input-host"),
    import("./native-renderer"),
    import("./toast-host"),
    import("./ui-host"),
  ]));

  installTauriConfigStoreHost();
  installTauriPredictionMarketsFetchTransport();
  const { config } = await measurePerfAsync("startup.tauri.backend-init", () => backendInitPromise);
  measurePerfAsync("startup.tauri.root-render", async () => {
    root.render(
      <UiHostProvider ui={webUiHost} renderer={webRendererHost} nativeRenderer={webNativeRenderer}>
        <WebInputHostProvider>
          <WebToastHostProvider>
            <WebDialogHostProvider>
              <App config={config} />
            </WebDialogHostProvider>
          </WebToastHostProvider>
        </WebInputHostProvider>
      </UiHostProvider>,
    );
  });
  bootLog.info("root render scheduled", {
    layoutPanes: config.layout.instances.length,
    floatingPanes: config.layout.floating.length,
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
