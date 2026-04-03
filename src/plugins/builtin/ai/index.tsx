import type { GloomPlugin } from "../../../types/plugin";
import { detectProviders } from "./providers";
import { AskAiDetailTab } from "./ask-ai-detail-tab";
import { AiScreenerPane } from "./screener-pane";
import { buildAiScreenerPaneSettingsDef, getAiScreenerPaneSettings } from "./settings";

export const aiPlugin: GloomPlugin = {
  id: "ai",
  name: "AI",
  version: "1.0.0",
  description: "Use local AI CLI with your financial data.",
  toggleable: true,

  setup(ctx) {
    const detectedProviders = detectProviders();
    const selectableProviders = detectedProviders.filter((provider) => provider.available);
    const providerOptions = (selectableProviders.length > 0 ? selectableProviders : detectedProviders)
      .map((provider) => ({
        label: provider.name,
        value: provider.id,
      }));
    const defaultProviderId = providerOptions[0]?.value ?? "claude";

    ctx.registerDetailTab({
      id: "ai-chat",
      name: "Ask AI",
      order: 60,
      component: AskAiDetailTab,
    });

    ctx.registerPane({
      id: "ai-screener",
      name: "AI Screener",
      icon: "A",
      component: AiScreenerPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 76, height: 24 },
      settings: (context) => buildAiScreenerPaneSettingsDef(
        getAiScreenerPaneSettings(context.settings),
      ),
    });

    ctx.registerPaneTemplate({
      id: "new-ai-screener-pane",
      paneId: "ai-screener",
      label: "AI Screener",
      description: "Create a prompt-driven AI screener pane with reusable screening tabs.",
      keywords: ["ai", "screener", "screen", "watchlist", "prompt"],
      shortcut: { prefix: "AI", argPlaceholder: "prompt", argKind: "text" },
      wizard: [
        {
          key: "providerId",
          label: "AI Provider",
          type: "select",
          defaultValue: defaultProviderId,
          options: providerOptions,
          body: ["Choose which local AI CLI should run the initial screener."],
        },
        {
          key: "prompt",
          label: "Screener Prompt",
          type: "textarea",
          placeholder: "Examples: humanoid robot suppliers, defense software compounders, EM payment rails, obesity-drug picks-and-shovels...",
          body: [
            "Describe the screening idea in plain English.",
            "The AI will return validated ticker ideas with a short reason for each one.",
          ],
        },
      ],
      createInstance: (_context, options) => {
        const prompt = options?.values?.prompt?.trim() || options?.arg?.trim() || "";
        if (!prompt) return null;
        const providerId = options?.values?.providerId || defaultProviderId;
        return {
          title: "AI Screener",
          placement: "floating",
          params: {
            prompt,
            providerId,
          },
        };
      },
    });
  },
};
