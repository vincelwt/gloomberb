import { discoverAiCliProviders } from "../../plugins/builtin/ai/cli-readiness";
import { getAiProviderUnavailableReason } from "../../plugins/builtin/ai/providers";
import { runAiPrompt } from "../../plugins/builtin/ai/runner";
import { createRssNewsCapability } from "../../plugins/builtin/news/wire/rss/source";
import type { CliCommandDef } from "../../types/plugin";
import { requireArg, takeOption } from "./command-utils";

function deferredResult(command: string, code: "auth_required" | "not_implemented", message: string) {
  return {
    command,
    status: code,
    code,
    message,
  };
}

export const brokerCliCommand: CliCommandDef = {
  name: "broker",
  aliases: ["brokers"],
  description: "Inspect broker profiles and guarded broker operations",
  help: { usage: ["broker list", "broker status", "broker add|edit|remove|connect|sync"] },
  execute: async (args, ctx) => {
    const action = args[0] ?? "list";
    const services = await ctx.initServices();
    try {
      if (action === "list" || action === "status") {
        const rows = services.config.brokerInstances.map((instance) => ({
          id: instance.id,
          type: instance.brokerType,
          label: instance.label,
          enabled: instance.enabled !== false,
          connectionMode: instance.connectionMode ?? "",
          lastSyncedAt: instance.lastSyncedAt ? new Date(instance.lastSyncedAt).toISOString() : "",
        }));
        ctx.printResult({ data: rows });
        return;
      }

      ctx.printResult({
        data: deferredResult("broker", "not_implemented", "Broker mutation and connection commands need shared non-UI broker service extraction before they can safely run headless."),
      });
    } finally {
      services.destroy();
    }
  },
};

export const ibkrCliCommand: CliCommandDef = {
  name: "ibkr",
  description: "Guarded IBKR account, order preview, and order action commands",
  help: { usage: ["ibkr accounts|positions|orders|preview|place|cancel"] },
  execute: async (args, ctx) => {
    const action = args[0] ?? "status";
    const profile = takeOption(args, "--profile");
    const account = takeOption(args, "--account");
    if ((action === "place" || action === "cancel") && (!profile || !account || !ctx.cliOptions.yes)) {
      ctx.fail(`ibkr ${action} requires --profile, --account, and --yes.`);
    }
    const services = await ctx.initServices();
    try {
      const ibkrProfiles = services.config.brokerInstances.filter((instance) => instance.brokerType === "ibkr");
      if (action === "accounts" || action === "status") {
        ctx.printResult({ data: ibkrProfiles.map((instance) => ({
          id: instance.id,
          label: instance.label,
          enabled: instance.enabled !== false,
          connectionMode: instance.connectionMode ?? "",
          lastSyncedAt: instance.lastSyncedAt ? new Date(instance.lastSyncedAt).toISOString() : "",
        })) });
        return;
      }
      ctx.printResult({
        data: {
          ...deferredResult("ibkr", "not_implemented", "IBKR trading commands are registered with safety gates, but headless order/account service extraction is still required."),
          action,
          profile: profile ?? null,
          account: account ?? null,
          dryRun: ctx.cliOptions.dryRun,
          confirmed: ctx.cliOptions.yes,
        },
      });
    } finally {
      services.destroy();
    }
  },
};

export const aiCliCommand: CliCommandDef = {
  name: "ai",
  description: "Inspect AI providers and run guarded headless AI prompts",
  help: { usage: ["ai providers", "ai ask [--provider id] <prompt>", "ai screen list|show|delete|refresh|export"] },
  execute: async (args, ctx) => {
    const action = args[0] ?? "providers";
    if (action === "providers") {
      const providers = await discoverAiCliProviders({ cwd: process.cwd() });
      ctx.printResult({ data: providers.map(({ provider }) => ({
        id: provider.id,
        name: provider.name,
        command: provider.command,
        available: provider.available,
        status: provider.status,
        unavailableReason: provider.unavailableReason,
      })) });
      return;
    }
    if (action === "ask") {
      const rawArgs = args.slice(1);
      const providers = await discoverAiCliProviders({ cwd: process.cwd() });
      const providerId = takeOption(rawArgs, "--provider")
        ?? providers.find(({ provider }) => provider.available)?.provider.id;
      const selected = providers.find(({ provider }) => provider.id === providerId)
        ?? ctx.fail("Unknown AI provider.");
      if (!selected.provider.available) ctx.fail(getAiProviderUnavailableReason(selected.provider));
      const prompt = rawArgs.join(" ").trim();
      if (!prompt) ctx.fail("Usage: gloomberb ai ask [--provider id] <prompt>");
      const controller = runAiPrompt({
        provider: selected.provider,
        prompt,
        cwd: process.cwd(),
        environment: selected.environment,
      });
      const text = await controller.done;
      ctx.printResult({ data: { provider: selected.provider.id, text } });
      return;
    }
    if (action === "screen") {
      ctx.printResult({
        data: deferredResult("ai screen", "not_implemented", "AI screener tabs are still pane-state backed; expose them through a shared non-UI screener store before headless mutation."),
      });
      return;
    }
    ctx.fail("Usage: gloomberb ai providers|ask|screen");
  },
};

export const rssCliCommand: CliCommandDef = {
  name: "rss",
  description: "Fetch an RSS feed as news rows",
  help: { usage: ["rss fetch <url> [--name label]"] },
  execute: async (args, ctx) => {
    const action = args[0] ?? "fetch";
    if (action !== "fetch") ctx.fail("Usage: gloomberb rss fetch <url> [--name label]");
    const rawArgs = args.slice(1);
    const name = takeOption(rawArgs, "--name") ?? "RSS";
    const url = requireArg(rawArgs[0], "Usage: gloomberb rss fetch <url> [--name label]", ctx);
    const capability = createRssNewsCapability([{
      id: "cli-feed",
      url,
      name,
      category: "cli",
      authority: 50,
      enabled: true,
    }]);
    const articles = await capability.provider.fetchNews({ feed: "latest", limit: ctx.cliOptions.limit ?? 20 });
    ctx.printResult({ data: articles.map((article) => ({
      title: article.title,
      source: article.source,
      publishedAt: article.publishedAt.toISOString(),
      url: article.url,
      summary: article.summary ?? "",
    })) });
  },
};

function cloudCommand(name: string, description: string): CliCommandDef {
  return {
    name,
    description,
    execute: (_args, ctx) => {
      ctx.printResult({
        data: deferredResult(name, "auth_required", "This command needs an existing cloud/session token. New auth/account/chat CLI workflows are deferred in this pass."),
      });
    },
  };
}

export const cloudCliCommands: CliCommandDef[] = [
  cloudCommand("buildout", "Fetch Buildout company data through an existing cloud session"),
  cloudCommand("congress", "Fetch congressional trade data through an existing cloud session"),
  cloudCommand("substack", "Fetch Substack reader data through an existing session"),
  cloudCommand("x-feed", "Fetch X/Twitter feed data through an existing cloud session"),
  cloudCommand("tweets", "Alias for x-feed"),
];
