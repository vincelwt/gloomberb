import { mkdir, rm, writeFile } from "fs/promises";
import { join, relative } from "path";

const outdir = join(process.cwd(), "dist", "tauri");
const tauriWebDir = join(process.cwd(), "src", "renderers", "tauri", "web");

function aliasImport(args: { path: string }, sourceSuffix: string, target: string) {
  if (args.path.endsWith(sourceSuffix)) {
    return { path: join(tauriWebDir, target) };
  }
  return undefined;
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(process.cwd(), "src", "renderers", "tauri", "web", "main.tsx")],
  outdir,
  target: "browser",
  format: "esm",
  splitting: true,
  sourcemap: "external",
  minify: true,
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
  plugins: [
    {
      name: "tauri-renderer-native-stubs",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => (
          aliasImport(args, "ibkr/gateway-service", "native-stubs/ibkr-gateway-service.ts")
          ?? aliasImport(args, "core/app-services", "app-services.ts")
          ?? aliasImport(args, "native/kitty-support", "native-stubs/chart-kitty-support.ts")
          ?? aliasImport(args, "native/surface-manager", "native-stubs/chart-surface-manager.ts")
          ?? aliasImport(args, "native/surface-sync", "native-stubs/chart-surface-sync.ts")
        ));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exitCode = 1;
  throw new Error("Failed to build Tauri web assets");
}

const entry = result.outputs.find((output) => output.kind === "entry-point" && output.path.endsWith(".js"));
if (!entry) {
  throw new Error("Tauri web build did not produce a JavaScript entrypoint");
}

const entrySrc = `./${relative(outdir, entry.path).replaceAll("\\", "/")}`;
await writeFile(join(outdir, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gloomberb</title>
    <style>
      @keyframes gloom-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      html, body, #root { width: 100%; height: 100%; min-height: 100%; overflow: hidden; background: #000; }
      body {
        --cell-w: 8px;
        --cell-h: 18px;
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
        line-height: var(--cell-h);
        color: #d8dde3;
        cursor: default;
        user-select: none;
        -webkit-font-smoothing: antialiased;
        text-rendering: geometricPrecision;
      }
      * { box-sizing: border-box; }
      #root > * { height: 100%; min-height: 100%; }
      input, textarea, button { font: inherit; }
      input, textarea { cursor: text; user-select: text; }
      button, [data-gloom-interactive="true"] { cursor: pointer; }
      [data-gloom-role="pane-window"] {
        background-clip: padding-box;
      }
      [data-gloom-role="pane-window"][data-floating="true"] {
        border: 1px solid var(--pane-border-color, #3a4148);
        border-radius: 6px;
        box-shadow: 0 18px 38px rgba(0, 0, 0, .46);
      }
      [data-gloom-role="pane-window"][data-focused="true"] {
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--pane-border-color, #54c99f) 30%, transparent), 0 18px 40px rgba(0, 0, 0, .5);
      }
      [data-gloom-role="pane-window"][data-floating="false"] {
        border: 0;
        border-radius: 0;
      }
      [data-gloom-role="pane-window"][data-floating="false"][data-focused="true"] {
        box-shadow: inset 0 0 0 1px var(--pane-border-color, #54c99f);
      }
      [data-gloom-role="pane-header"] {
        align-items: center;
        padding-inline: 7px;
        cursor: grab;
        -webkit-user-select: none;
        user-select: none;
      }
      [data-gloom-role="pane-header"] * {
        cursor: inherit;
      }
      [data-gloom-role="pane-action"],
      [data-gloom-role="pane-close"] {
        cursor: pointer;
      }
      body.gloom-dragging [data-gloom-role="pane-header"] {
        cursor: grabbing;
      }
      body.gloom-dragging {
        cursor: grabbing;
      }
      [data-gloom-role="pane-title"] {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      [data-gloom-role="status-bar"] {
        min-height: var(--cell-h);
        max-height: var(--cell-h);
        align-items: center;
        border-top: 1px solid color-mix(in srgb, #3a4148 72%, transparent);
        font-size: 11.5px;
      }
      [data-gloom-role="status-bar"] span {
        line-height: var(--cell-h);
      }
      [data-gloom-role="pane-action"],
      [data-gloom-role="pane-close"] {
        border-radius: 4px;
        padding-inline: 2px;
      }
      [data-gloom-role="pane-action"]:hover,
      [data-gloom-role="pane-close"]:hover {
        background: rgba(255,255,255,.08);
      }
      [data-gloom-role="resize-handle"] {
        cursor: nwse-resize;
      }
      [data-gloom-role="chart-surface"] {
        cursor: crosshair;
      }
      [data-gloom-scrollbar-x="hidden"]::-webkit-scrollbar:horizontal {
        height: 0;
        display: none;
      }
      [data-gloom-scrollbar-y="hidden"]::-webkit-scrollbar:vertical {
        width: 0;
        display: none;
      }
      [data-gloom-role="resize-handle"]::after {
        content: "";
        position: absolute;
        right: 4px;
        bottom: 4px;
        width: 9px;
        height: 9px;
        border-right: 1px solid currentColor;
        border-bottom: 1px solid currentColor;
        opacity: .7;
      }
      [data-gloom-role="dock-divider"] {
        background: transparent !important;
      }
      [data-gloom-role="dock-divider"]::before {
        content: "";
        position: absolute;
        background: var(--divider-color);
        opacity: .9;
      }
      [data-gloom-role="dock-divider"][data-axis="horizontal"] {
        cursor: col-resize;
      }
      [data-gloom-role="dock-divider"][data-axis="horizontal"]::before {
        top: 0;
        bottom: 0;
        left: 50%;
        width: 1px;
      }
      [data-gloom-role="dock-divider"][data-axis="vertical"] {
        cursor: row-resize;
      }
      [data-gloom-role="dock-divider"][data-axis="vertical"]::before {
        left: 0;
        right: 0;
        top: 50%;
        height: 1px;
      }
      .gloom-loading, .gloom-fatal { padding: 24px; color: #d8dde3; }
      .gloom-fatal pre { white-space: pre-wrap; color: #ffb4a8; }
      .gloom-toast-viewport {
        position: fixed;
        right: 16px;
        bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 10000;
      }
      .gloom-toast {
        min-width: 260px;
        max-width: 420px;
        padding: 10px 12px;
        border: 1px solid #3a4148;
        background: #151b20;
        color: #d8dde3;
        box-shadow: 0 12px 24px rgba(0,0,0,.28);
      }
      .gloom-toast-success { border-color: #54c99f; }
      .gloom-toast-error { border-color: #ff6b5f; }
      .gloom-toast-action {
        margin-top: 8px;
        color: #101417;
        background: #d8dde3;
        border: 0;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .gloom-dialog-backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.72);
        z-index: 9999;
      }
      .gloom-dialog {
        max-width: min(920px, calc(100vw - 48px));
        max-height: calc(100vh - 48px);
        overflow: auto;
        border: 1px solid #54c99f;
        background: #101417;
        color: #d8dde3;
        padding: 14px;
      }
    </style>
  </head>
  <body style="margin:0;background:#000;">
    <div id="root"><div class="gloom-loading">Loading Gloomberb...</div></div>
    <script>
      const renderBootstrapError = (error, details = "") => {
        const root = document.getElementById("root");
        if (!root) return;
        const message = error && typeof error === "object" && "message" in error ? error.message : String(error);
        const stack = error && typeof error === "object" && "stack" in error ? error.stack : "";
        root.innerHTML = '<div class="gloom-fatal"><h1>Gloomberb failed to start</h1><pre></pre></div>';
        root.querySelector("pre").textContent = [message, details, stack].filter(Boolean).join("\\n");
      };
      window.addEventListener("error", (event) => renderBootstrapError(
        event.error || event.message,
        [event.filename, event.lineno, event.colno].filter(Boolean).join(":"),
      ));
      window.addEventListener("unhandledrejection", (event) => renderBootstrapError(event.reason));
      document.getElementById("root").innerHTML = '<div class="gloom-loading">Booting Gloomberb renderer...</div>';
    </script>
    <script type="module" src="${entrySrc}"></script>
  </body>
</html>
`);
