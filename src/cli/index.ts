import { VERSION } from "../version";
import type { CliCommandDef, CliDispatchResult } from "../types/plugin";
import type { LoadedExternalPlugin } from "../plugins/loader";
import { loadCliConfigIfAvailable } from "./context";
import {
  buildCliCommandRegistry,
  createCliCommandContext,
  normalizeCliCommandToken,
  normalizeCliDispatchResult,
  renderCliHelp,
  type CliCommandRegistry,
} from "./registry";
import { fail } from "./errors";
import { search, searchCandidatesForCli, buildSearchReport } from "./commands/search";
import { ticker, buildTickerReport } from "./commands/ticker";
import {
  installPlugin,
  listPlugins,
  removePlugin,
  updatePlugins,
} from "./commands/plugins";

function createCoreCliCommands(renderHelp: () => string): CliCommandDef[] {
  return [
    {
      name: "help",
      aliases: ["--help", "-h"],
      description: "Show this help message",
      help: {
        usage: ["help"],
      },
      execute: () => {
        console.log(renderHelp());
      },
    },
    {
      name: "search",
      description: "Search tickers and company names",
      help: {
        usage: ["search <query>"],
      },
      execute: async (args, ctx) => {
        const query = args.join(" ");
        await search(query, {
          initMarketData: ctx.initMarketData,
          fail: ctx.fail,
        });
      },
    },
    {
      name: "ticker",
      description: "Show quote, ownership, and detailed financials",
      help: {
        usage: ["ticker <symbol>"],
      },
      execute: async (args, ctx) => {
        const symbol = args[0];
        if (!symbol) {
          ctx.fail("Usage: gloomberb ticker <symbol>");
        }
        await ticker(symbol!, {
          initMarketData: ctx.initMarketData,
          closeAndFail: ctx.closeAndFail,
        });
      },
    },
    {
      name: "install",
      description: "Install a plugin from GitHub",
      help: {
        usage: ["install <user/repo>"],
      },
      execute: async (args) => {
        const ref = args[0];
        if (!ref) {
          fail("Usage: gloomberb install <github-user/repo>");
        }
        await installPlugin(ref);
      },
    },
    {
      name: "remove",
      aliases: ["uninstall"],
      description: "Remove an installed plugin",
      help: {
        usage: ["remove <name>"],
      },
      execute: async (args) => {
        const name = args[0];
        if (!name) {
          fail("Usage: gloomberb remove <plugin-name>");
        }
        await removePlugin(name);
      },
    },
    {
      name: "update",
      description: "Update plugins",
      help: {
        usage: ["update [name]"],
      },
      execute: async (args) => {
        await updatePlugins(args[0]);
      },
    },
    {
      name: "plugins",
      aliases: ["list"],
      description: "List installed plugins",
      help: {
        usage: ["plugins"],
      },
      execute: () => {
        listPlugins();
      },
    },
  ];
}

export interface DispatchCliOptions {
  externalPlugins?: LoadedExternalPlugin[];
}

async function createRegistry(options: DispatchCliOptions = {}): Promise<CliCommandRegistry> {
  const config = await loadCliConfigIfAvailable();
  let registry: CliCommandRegistry | null = null;
  const coreCommands = createCoreCliCommands(() => renderCliHelp(registry!, VERSION));
  registry = buildCliCommandRegistry({
    coreCommands,
    externalPlugins: options.externalPlugins ?? [],
    config,
  });
  return registry;
}

export { buildSearchReport, buildTickerReport, searchCandidatesForCli };

export async function dispatchCli(args: string[], options: DispatchCliOptions = {}): Promise<CliDispatchResult> {
  const command = args[0];
  if (!command) {
    return { kind: "unhandled" };
  }

  const registry = await createRegistry(options);
  const resolved = registry.lookup.get(normalizeCliCommandToken(command));
  if (!resolved) {
    return { kind: "unhandled" };
  }

  const result = await resolved.command.execute(
    args.slice(1),
    createCliCommandContext(resolved.ownerId, registry.plugins),
  );
  return normalizeCliDispatchResult(result);
}

export async function runCli(args: string[], options: DispatchCliOptions = {}): Promise<boolean> {
  const result = await dispatchCli(args, options);
  return result.kind === "handled";
}
