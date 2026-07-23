import type { WizardStep } from "../../../types/plugin";
import type { AiProvider } from "./providers";
import {
  getAiProviderUnavailableLabel,
  migrateLegacyAiProviderId,
  resolveDefaultAiProviderId,
} from "./providers";
import {
  getAiRuntimeCatalog,
  type AiRunOutputMode,
  type AiRuntimeCatalog,
} from "./runner";

export const AI_AUTO_MODEL_VALUE = "__auto__";

export interface AiRunnerSelectionScope {
  outputMode?: AiRunOutputMode;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  runtimeCatalog?: AiRuntimeCatalog;
}

export interface AiRunnerDefault {
  providerId: string;
  modelId: string | null;
}

export interface AiModelSelectionOption {
  value: string;
  label: string;
  description?: string;
}

export function isAiProviderReady(provider: AiProvider): boolean {
  return provider.available && (provider.status === undefined || provider.status === "ready");
}

export function supportsAiRunOutputMode(
  provider: AiProvider,
  outputMode: AiRunOutputMode,
  runtimeCatalog = getAiRuntimeCatalog(),
): boolean {
  const runtimeProvider = runtimeCatalog.providers.find((candidate) => (
    candidate.providerId === provider.id
  ));
  return (runtimeProvider?.outputModes ?? provider.outputModes).includes(outputMode);
}

export function getSelectableAiRunners(
  providers: readonly AiProvider[],
  scope: AiRunnerSelectionScope = {},
): AiProvider[] {
  const outputMode = scope.outputMode ?? "plain";
  const catalog = scope.runtimeCatalog ?? getAiRuntimeCatalog();
  const capable = providers.filter((provider) => (
    supportsAiRunOutputMode(provider, outputMode, catalog)
  ));
  return capable;
}

export function normalizeAiModelId(value: string | null | undefined): string | null {
  const modelId = value?.trim() ?? "";
  return modelId && modelId !== AI_AUTO_MODEL_VALUE ? modelId : null;
}

export function getAiModelSelectionOptions(
  providerId: string,
  currentModelId?: string | null,
  runtimeCatalog = getAiRuntimeCatalog(),
): AiModelSelectionOption[] {
  const canonicalProviderId = migrateLegacyAiProviderId(providerId);
  const provider = runtimeCatalog.providers.find((candidate) => (
    candidate.providerId === canonicalProviderId
  ));
  const models = runtimeCatalog.models.filter((model) => (
    model.providerId === canonicalProviderId
  ));
  const defaultModel = models.find((model) => model.id === provider?.defaultModelId);
  const options: AiModelSelectionOption[] = [
    {
      value: AI_AUTO_MODEL_VALUE,
      label: defaultModel
        ? `Auto · ${defaultModel.label}`
        : provider?.defaultModelId
          ? `Auto · ${provider.defaultModelId}`
          : "Auto · provider default",
      description: "Use the provider's recommended model.",
    },
    ...models.map((model) => ({
      value: model.id,
      label: model.available ? model.label : `${model.label} · connect to use`,
      description: model.available
        ? "Available for the connected account."
        : "This model becomes available after the provider is connected.",
    })),
  ];
  const normalizedCurrent = normalizeAiModelId(currentModelId);
  if (normalizedCurrent && !models.some((model) => model.id === normalizedCurrent)) {
    options.push({
      value: normalizedCurrent,
      label: `${normalizedCurrent} · current`,
      description: "Saved before the current Pi model catalog was loaded.",
    });
  }
  return options;
}

export function getAiRunnerWizardModelKey(providerId: string): string {
  return `modelId:${migrateLegacyAiProviderId(providerId)}`;
}

export function resolveAiRunnerWizardModel(
  values: Record<string, string> | undefined,
  providerId: string,
  fallbackModelId?: string | null,
): string | null {
  const selected = values?.[getAiRunnerWizardModelKey(providerId)]
    ?? values?.modelId
    ?? fallbackModelId;
  return normalizeAiModelId(selected);
}

export function modelIdAfterAiProviderChange(
  providerId: string,
  defaultProviderId: string,
  defaultModelId: string | null | undefined,
): string {
  return migrateLegacyAiProviderId(providerId) === migrateLegacyAiProviderId(defaultProviderId)
    ? normalizeAiModelId(defaultModelId) ?? ""
    : "";
}

export function resolveReadyAiRunnerDefault(
  providers: readonly AiProvider[],
  configuredProviderId?: string | null,
  configuredModelId?: string | null,
): AiRunnerDefault {
  const configuredId = migrateLegacyAiProviderId(configuredProviderId?.trim() ?? "");
  const configured = providers.find((provider) => provider.id === configuredId);
  const ready = providers.find(isAiProviderReady);
  const providerId = configured && (isAiProviderReady(configured) || !ready)
    ? configured.id
    : ready?.id ?? resolveDefaultAiProviderId(providers);
  return {
    providerId,
    modelId: providerId === configuredId ? normalizeAiModelId(configuredModelId) : null,
  };
}

export function buildAiRunnerWizard(
  providers: readonly AiProvider[],
  scope: AiRunnerSelectionScope = {},
): WizardStep[] {
  const runners = getSelectableAiRunners(providers, scope);
  const defaults = resolveReadyAiRunnerDefault(
    runners,
    scope.defaultProviderId,
    scope.defaultModelId,
  );
  const runtimeCatalog = scope.runtimeCatalog ?? getAiRuntimeCatalog();
  return [
    {
      key: "providerId",
      label: "AI Provider",
      type: "select",
      defaultValue: defaults.providerId,
      options: runners.map((provider) => ({
        label: isAiProviderReady(provider)
          ? provider.name
          : `${provider.name} (${getAiProviderUnavailableLabel(provider)})`,
        value: provider.id,
      })),
      body: ["Choose the AI provider for this conversation."],
    },
    ...runners.map((provider): WizardStep => {
      const selectedModelId = provider.id === defaults.providerId ? defaults.modelId : null;
      return {
        key: getAiRunnerWizardModelKey(provider.id),
        label: "AI Model",
        type: "select",
        required: true,
        dependsOn: { key: "providerId", value: provider.id },
        defaultValue: selectedModelId ?? AI_AUTO_MODEL_VALUE,
        options: getAiModelSelectionOptions(provider.id, selectedModelId, runtimeCatalog),
        body: ["Choose from the models published by Pi, or use the provider default."],
      };
    }),
  ];
}

export function formatAiRunnerSelection(providerName: string, modelId: string | null | undefined): string {
  return normalizeAiModelId(modelId) ? `${providerName} · ${normalizeAiModelId(modelId)}` : providerName;
}
