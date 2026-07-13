import type { GloomPlugin, PaneTemplateContext, PaneTemplateCreateOptions } from "../../../types/plugin";
import { DEFAULT_FLOATING_SIZE, KELLY_PANE_ID } from "./constants";
import { KellySizerPane } from "./pane";

function resolveTemplateSymbol(context: PaneTemplateContext, options?: PaneTemplateCreateOptions): string | null {
  return options?.symbol
    ?? options?.ticker?.metadata.ticker
    ?? options?.arg?.trim().toUpperCase()
    ?? context.activeTicker
    ?? null;
}

export const kellySizerPlugin: GloomPlugin = {
  id: KELLY_PANE_ID,
  name: "Position Sizer",
  version: "1.0.0",
  description: "Size positions from Kelly, risk budget, and asymmetric payoff assumptions.",
  toggleable: true,
  panes: [
    {
      id: KELLY_PANE_ID,
      name: "Position Sizer",
      icon: "K",
      component: KellySizerPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: DEFAULT_FLOATING_SIZE,
    },
  ],
  paneTemplates: [
    {
      id: "kelly-sizer-pane",
      paneId: KELLY_PANE_ID,
      label: "Position Sizer",
      description: "Open Kelly-based position sizing for a ticker.",
      keywords: ["kelly", "position", "sizing", "risk", "bet", "portfolio"],
      shortcut: { prefix: "KELLY", argPlaceholder: "ticker", argKind: "ticker", argOptional: true },
      canCreate: (context, options) => !!resolveTemplateSymbol(context, options),
      createInstance: (context, options) => {
        const symbol = resolveTemplateSymbol(context, options);
        return symbol ? { params: { symbol }, placement: "floating" } : null;
      },
    },
  ],
};
