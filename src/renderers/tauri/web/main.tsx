/// <reference lib="dom" />
/** @jsxImportSource react */
import { createRoot } from "react-dom/client";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}

const root = createRoot(rootElement);

root.render(<div className="gloom-loading">Starting Gloomberb...</div>);

async function boot() {
  const backendModulePromise = import("./backend-rpc");
  const backendInitPromise = backendModulePromise.then(({ initTauriBackend }) => initTauriBackend());
  // Avoid a premature global unhandled-rejection render while UI chunks load.
  void backendInitPromise.catch(() => {});

  const [
    { App },
    { UiHostProvider },
    { WebDialogHostProvider },
    { installTauriConfigStoreHost },
    { WebInputHostProvider },
    { webNativeRenderer },
    { WebToastHostProvider },
    { webRendererHost, webUiHost },
  ] = await Promise.all([
    import("../../../app"),
    import("../../../ui/host"),
    import("./dialog-host"),
    import("./config-host"),
    import("./input-host"),
    import("./native-renderer"),
    import("./toast-host"),
    import("./ui-host"),
  ]);

  installTauriConfigStoreHost();
  const { config } = await backendInitPromise;
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
}

boot().catch((error) => {
  root.render(
    <div className="gloom-fatal">
      <h1>Gloomberb failed to start</h1>
      <pre>{error instanceof Error ? error.stack ?? error.message : String(error)}</pre>
    </div>,
  );
});
