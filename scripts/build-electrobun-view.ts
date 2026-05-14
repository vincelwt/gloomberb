import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join, relative } from "path";
import { TITLEBAR_OVERLAY_HEIGHT_PX } from "../src/components/layout/titlebar-overlay";

const outdir = join(process.cwd(), "dist", "electrobun-view");
const electrobunViewDir = join(process.cwd(), "src", "renderers", "electrobun", "view");

function aliasImport(args: { path: string }, sourceSuffix: string, target: string) {
  if (args.path.endsWith(sourceSuffix)) {
    return { path: join(electrobunViewDir, target) };
  }
  return undefined;
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(process.cwd(), "src", "renderers", "electrobun", "view", "main.tsx")],
  outdir,
  target: "browser",
  format: "esm",
  splitting: false,
  sourcemap: "external",
  minify: true,
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
  plugins: [
    {
      name: "electrobun-renderer-native-bridges",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => (
          aliasImport(args, "plugins/builtin/notes-files", "notes-files.ts")
          ?? aliasImport(args, "notes-files", "notes-files.ts")
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
  throw new Error("Failed to build Electrobun view assets");
}

const entry = result.outputs.find((output) => output.kind === "entry-point" && output.path.endsWith(".js"));
if (!entry) {
  throw new Error("Electrobun view build did not produce a JavaScript entrypoint");
}

const entrySrc = `./${relative(outdir, entry.path).replaceAll("\\", "/")}`;
const stylesheet = (await readFile(join(electrobunViewDir, "styles.css"), "utf8"))
  .replaceAll("__TITLEBAR_OVERLAY_HEIGHT_PX__", String(TITLEBAR_OVERLAY_HEIGHT_PX));

await writeFile(join(outdir, "index.html"), renderElectrobunViewHtml(entrySrc, stylesheet));

function renderElectrobunViewHtml(entrySrc: string, stylesheet: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gloomberb</title>
    <style>${stylesheet}</style>
  </head>
  <body style="margin:0;background:#000;">
    <div id="root"><div class="gloom-loading">Loading Gloomberb...</div></div>
    <script>
      const bootstrapFatalHtml = [
        '<div class="gloom-fatal">',
        '<h1>Gloomberb failed to start</h1>',
        '<div class="gloom-fatal-actions">',
        '<button type="button" data-variant="primary" data-action="reload">Reload window</button>',
        '<button type="button" data-action="copy">Copy error</button>',
        '</div>',
        '<div class="gloom-fatal-status" aria-live="polite"></div>',
        '<pre></pre>',
        '</div>',
      ].join("");
      const renderBootstrapError = (error, details = "") => {
        if (typeof window.__gloomRenderFatalError === "function") {
          window.__gloomRenderFatalError(error, details);
          return;
        }
        const root = document.getElementById("root");
        if (!root) return;
        const message = error && typeof error === "object" && "message" in error ? error.message : String(error);
        const stack = error && typeof error === "object" && "stack" in error ? error.stack : "";
        const errorText = [message, details, stack].filter(Boolean).join("\\n");
        root.innerHTML = bootstrapFatalHtml;
        root.querySelector("pre").textContent = errorText;
        root.querySelector('[data-action="reload"]')?.addEventListener("click", () => window.location.reload());
        root.querySelector('[data-action="copy"]')?.addEventListener("click", async () => {
          const status = root.querySelector(".gloom-fatal-status");
          try {
            await navigator.clipboard.writeText(errorText);
            status.textContent = "Error copied.";
          } catch (copyError) {
            status.textContent = "Copy failed.";
          }
        });
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
`;
}
