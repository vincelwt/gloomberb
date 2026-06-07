import { extname, resolve } from "path";
import type { CliCommandContext } from "../../types/plugin";
import type { MarketContext } from "../types";
import {
  filterPaneCatalogEntries,
  renderPaneCatalogReport,
  type PaneFunctionCatalog,
} from "./catalog";
import { createPaneCatalog } from "./discovery";
import {
  normalizeLookupToken,
  optionPaneState,
  parseArgumentsOption,
  parsePaneCatalogArgs,
  parsePaneFunctionArgs,
  type ParsedPaneFunctionArgs,
} from "./options";
import { resolvePaneFunction, type ResolvedPaneFunction } from "./resolver";
import { buildFunctionReport } from "./report";
import { defaultScreenshotPath, renderDesktopShot } from "./screenshot";
import {
  buildPaneCatalogEntries,
} from "./catalog";

async function withPaneRuntime<T>(
  ctx: CliCommandContext,
  args: string[],
  run: (runtime: {
    parsed: ParsedPaneFunctionArgs;
    context: MarketContext;
    registry: PaneFunctionCatalog;
    resolved: ResolvedPaneFunction;
  }) => Promise<T>,
): Promise<T> {
  const parsed = parsePaneFunctionArgs(args);
  const context = await ctx.initMarketData();
  const registry = await createPaneCatalog(context, ctx.plugins);
  try {
    const resolved = await resolvePaneFunction(registry, context, parsed);
    return await run({ parsed, context, registry, resolved });
  } finally {
    registry.destroy();
    context.persistence.close();
  }
}

export async function runPaneFunction(args: string[], ctx: CliCommandContext) {
  await runPaneCliCommand(ctx, async () => {
    await withPaneRuntime(ctx, args, async ({ parsed, context, resolved }) => {
      const report = await buildFunctionReport(resolved, context, parsed.arg, parsed.options);
      console.log(report);
    });
  });
}

export async function runPaneScreenshot(args: string[], ctx: CliCommandContext) {
  await runPaneCliCommand(ctx, async () => {
    await withPaneRuntime(ctx, args, async ({ parsed, context, resolved }) => {
      const outputPath = parsed.outputPath
        ? resolve(process.cwd(), ensurePngExtension(parsed.outputPath))
        : defaultScreenshotPath(resolved, parsed.arg);
      await renderDesktopShot({
        resolved,
        context,
        rawArg: parsed.arg,
        outputPath,
        width: parsed.width,
        height: parsed.height,
        options: parsed.options,
      });
      console.log(`Saved screenshot to ${outputPath}`);
    });
  });
}

export async function runPaneCatalog(args: string[], ctx: CliCommandContext) {
  await runPaneCliCommand(ctx, async () => {
    const parsed = parsePaneCatalogArgs(args);
    const effectiveParsed = {
      ...parsed,
      limit: ctx.cliOptions.limit ?? parsed.limit,
    };
    const context = await ctx.initMarketData();
    const registry = await createPaneCatalog(context, ctx.plugins);
    try {
      const entries = await buildPaneCatalogEntries(registry, context);
      const filtered = filterPaneCatalogEntries(entries, parsed.query);
      if (ctx.cliOptions.format === "text") {
        console.log(renderPaneCatalogReport(filtered, effectiveParsed));
      } else {
        ctx.printResult({ data: filtered.slice(0, effectiveParsed.limit) });
      }
    } finally {
      registry.destroy();
      context.persistence.close();
    }
  });
}

async function runPaneCliCommand(ctx: CliCommandContext, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.fail(message);
  }
}

function ensurePngExtension(path: string): string {
  return extname(path) ? path : `${path}.png`;
}

export const paneFunctionTestInternals = {
  parsePaneFunctionArgs,
  parsePaneCatalogArgs,
  normalizeLookupToken,
  parseArgumentsOption,
  optionPaneState,
  filterPaneCatalogEntries,
  renderPaneCatalogReport,
};
