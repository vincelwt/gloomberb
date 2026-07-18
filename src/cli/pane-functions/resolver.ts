import type { PaneInstanceConfig } from "../../types/config";
import type { PaneDef, PaneTemplateCreateOptions, PaneTemplateDef } from "../../types/plugin";
import { normalizeTickerInput } from "../../tickers/search";
import { slugifyName } from "../../utils/slugify";
import type { MarketContext } from "../types";
import {
  buildPaneFunctionLookup,
  buildTemplateContext,
  type PaneFunctionCatalog,
} from "./catalog";
import {
  buildCreateOptions,
  cleanTickerInput,
  normalizeLookupToken,
  optionSettings,
  type ParsedPaneFunctionArgs,
} from "./options";
import {
  capabilityPaneSettings,
  getPaneFunctionCapability,
  normalizeCapabilityOptions,
  type NormalizedPaneFunctionOptions,
  type PaneFunctionCapability,
} from "./capabilities";

export interface ResolvedPaneFunction {
  token: string;
  label: string;
  description: string;
  shortcut?: string;
  pane: PaneDef;
  template?: PaneTemplateDef;
  instance: PaneInstanceConfig;
  createOptions: PaneTemplateCreateOptions | undefined;
  optionSettings: Record<string, unknown>;
  capability: PaneFunctionCapability;
  options: NormalizedPaneFunctionOptions;
}

async function buildPaneInstance(
  resolved: Pick<ResolvedPaneFunction, "pane" | "template" | "createOptions" | "optionSettings">,
  context: MarketContext,
  target: string,
): Promise<PaneInstanceConfig> {
  const primarySymbol = resolved.createOptions?.symbol
    ?? resolved.createOptions?.symbols?.[0]
    ?? normalizeTickerInput(null, cleanTickerInput(target));
  const templateContext = buildTemplateContext(context, primarySymbol ?? null);
  const spec = await resolved.template?.createInstance?.(templateContext, resolved.createOptions) ?? {};
  const instanceId = `${resolved.pane.id}:cli-${slugifyName(target || resolved.pane.id, "pane")}`;
  return {
    instanceId,
    paneId: resolved.pane.id,
    title: spec.title ?? primarySymbol ?? resolved.pane.name,
    binding: spec.binding ?? (primarySymbol ? { kind: "fixed", symbol: primarySymbol } : { kind: "none" }),
    params: spec.params,
    settings: {
      ...spec.settings,
      ...resolved.optionSettings,
    },
  };
}

export async function resolvePaneFunction(
  registry: PaneFunctionCatalog,
  context: MarketContext,
  args: ParsedPaneFunctionArgs,
): Promise<ResolvedPaneFunction> {
  if (!args.target) {
    throw new Error("Usage: gloomberb fn <function-or-pane> [argument] [--key value]");
  }

  const lookup = buildPaneFunctionLookup(registry);
  const entry = lookup.get(normalizeLookupToken(args.target));
  if (!entry) {
    const shortcuts = [...registry.paneTemplates.values()]
      .map((template) => template.shortcut?.prefix)
      .filter((prefix): prefix is string => !!prefix)
      .sort();
    throw new Error(`Unknown function or pane "${args.target}". Try one of: ${shortcuts.slice(0, 18).join(", ")}`);
  }

  const template = "paneId" in entry && "description" in entry ? entry as PaneTemplateDef : undefined;
  const pane = template
    ? registry.panes.get(template.paneId)
    : entry as PaneDef;
  if (!pane) {
    throw new Error(`Template "${template?.id}" points at missing pane "${template?.paneId}".`);
  }
  const createOptions = buildCreateOptions(template, args.arg);
  const capability = getPaneFunctionCapability(template, pane);
  const normalizedOptions = normalizeCapabilityOptions(capability, args.options, {
    strict: args.requireBotSafe,
  });
  const settings = capability.botSafe
    ? {
      ...optionSettings(args.options),
      ...capabilityPaneSettings(capability, normalizedOptions),
    }
    : optionSettings(args.options);
  if (args.requireBotSafe) {
    validateTickerCardinality(capability, createOptions);
  }
  const resolved: ResolvedPaneFunction = {
    token: template?.shortcut?.prefix ?? template?.id ?? pane.id,
    label: template?.label ?? pane.name,
    description: template?.description ?? `Open the ${pane.name} pane.`,
    shortcut: template?.shortcut?.prefix,
    pane,
    template,
    instance: {} as PaneInstanceConfig,
    createOptions,
    optionSettings: settings,
    capability,
    options: normalizedOptions,
  };
  resolved.instance = await buildPaneInstance(resolved, context, args.arg || pane.id);
  return resolved;
}

function validateTickerCardinality(
  capability: PaneFunctionCapability,
  createOptions: PaneTemplateCreateOptions | undefined,
): void {
  if (!capability.botSafe || capability.tickerCardinality === "none") return;
  const count = createOptions?.symbols?.length
    ?? (createOptions?.symbol ? 1 : 0);
  const valid = capability.tickerCardinality === "one"
    ? count === 1
    : capability.tickerCardinality === "one-or-more"
      ? count >= 1
      : capability.tickerCardinality === "two-or-more"
        ? count >= 2
        : count >= 1 && count <= 2;
  if (valid) return;

  const expectation = capability.tickerCardinality === "one"
    ? "exactly one ticker"
    : capability.tickerCardinality === "one-or-more"
      ? "at least one ticker"
      : capability.tickerCardinality === "two-or-more"
        ? "at least two tickers"
        : "one or two tickers";
  throw new Error(`${capability.id} requires ${expectation}.`);
}
