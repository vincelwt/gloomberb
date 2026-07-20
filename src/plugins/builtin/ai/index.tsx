import type { GloomPlugin } from "../../../types/plugin";
import { AskAiResearchTab } from "./ask-ai-detail-tab";
import { detectProviders, getLocalWorkspaceProviders } from "./providers";
import { AiScreenerPane } from "./screener/pane";
import { buildAiScreenerPaneSettingsDef, getAiScreenerPaneSettings } from "./settings";
import { LocalAgentWorkspacePane } from "./workspace/pane";

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
    const localWorkspaceProviders = getLocalWorkspaceProviders(detectedProviders);
    const localWorkspaceProviderOptions = localWorkspaceProviders.map((provider) => ({
      label: provider.available ? provider.name : `${provider.name} (not detected)`,
      value: provider.id,
    }));

    ctx.registerTickerResearchTab({
      id: "ai-chat",
      name: "Ask AI",
      order: 60,
      component: AskAiResearchTab,
    });

    ctx.registerPane({
      id: "local-agent-workspace",
      name: "Local AI",
      icon: "A",
      component: LocalAgentWorkspacePane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 96, height: 32 },
    });

    ctx.registerPaneTemplate({
      id: "new-local-agent-workspace",
      paneId: "local-agent-workspace",
      label: "Local AI Workspace",
      description: "Create a persistent local Claude Code or Codex research thread.",
      keywords: ["ai", "agent", "claude", "codex", "local", "research", "thread"],
      shortcut: { prefix: "AGENT" },
      wizard: [{
        key: "providerId",
        label: "Local Runtime",
        type: "select",
        defaultValue: localWorkspaceProviderOptions[0]?.value ?? "claude",
        options: localWorkspaceProviderOptions,
        body: [
          "Choose the locally authenticated runtime for this thread.",
          "The runtime cannot be changed after creation; choose New Thread to use another one.",
        ],
      }],
      createInstance: (_context, options) => {
        const providerId = options?.values?.providerId;
        if (providerId !== "claude" && providerId !== "codex" && providerId !== "pi") return null;
        return {
          title: "Local AI",
          placement: "floating",
          params: { providerId, threadId: crypto.randomUUID() },
        };
      },
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
