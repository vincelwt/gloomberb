import type {
  PaneTemplateContext,
  PaneTemplateCreateOptions,
  PaneTemplateDef,
  PaneTemplateInstanceConfig,
} from "../../types/plugin";
import { normalizeTickerInput } from "../../utils/ticker-search";

export interface TickerSurfacePaneTemplateOptions {
  id: string;
  paneId: string;
  label: string;
  description: string;
  keywords: string[];
  shortcut: string;
  titlePrefix?: string;
  canCreate?: (
    context: PaneTemplateContext,
    options: PaneTemplateCreateOptions | undefined,
    symbol: string,
  ) => boolean;
}

export function resolveTickerSurfaceSymbol(
  context: Pick<PaneTemplateContext, "activeTicker">,
  options?: Pick<PaneTemplateCreateOptions, "arg" | "symbol">,
): string | null {
  const explicitSymbol = options?.symbol?.trim().toUpperCase();
  return explicitSymbol || normalizeTickerInput(context.activeTicker, options?.arg);
}

export function createTickerSurfacePaneInstance(
  context: Pick<PaneTemplateContext, "activeTicker">,
  options: Pick<PaneTemplateCreateOptions, "arg" | "symbol"> | undefined,
  titlePrefix: string,
): PaneTemplateInstanceConfig | null {
  const ticker = resolveTickerSurfaceSymbol(context, options);
  return ticker
    ? {
      title: `${titlePrefix} ${ticker}`,
      binding: { kind: "fixed", symbol: ticker },
      placement: "floating",
    }
    : null;
}

export function createTickerSurfacePaneTemplate(
  templateOptions: TickerSurfacePaneTemplateOptions,
): PaneTemplateDef {
  const titlePrefix = templateOptions.titlePrefix ?? templateOptions.shortcut;
  return {
    id: templateOptions.id,
    paneId: templateOptions.paneId,
    label: templateOptions.label,
    description: templateOptions.description,
    keywords: templateOptions.keywords,
    shortcut: {
      prefix: templateOptions.shortcut,
      argPlaceholder: "ticker",
      argKind: "ticker",
    },
    canCreate: (context, createOptions) => {
      const symbol = resolveTickerSurfaceSymbol(context, createOptions);
      return symbol !== null && (templateOptions.canCreate?.(context, createOptions, symbol) ?? true);
    },
    createInstance: (context, createOptions) => createTickerSurfacePaneInstance(context, createOptions, titlePrefix),
  };
}
