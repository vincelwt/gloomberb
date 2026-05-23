import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { buildBrokerProfileConfig, validateBrokerProfileValues } from "../../brokers/profile-form";
import { syncBrokerInstance } from "../../brokers/sync-broker-instance";
import { saveConfig } from "../../data/config-store";
import type { PluginRegistry } from "../../plugins/registry";
import type { AppConfig } from "../../types/config";
import { createBrokerInstanceId } from "../../utils/broker-instances";
import { debugLog } from "../../utils/debug-log";
import type { BrokerSyncSummary, PortfolioSub } from "./onboarding-steps";
import type { BrokerOption } from "./wizard-model";

const onboardingLog = debugLog.createLogger("onboarding");

export function summarizeOnboardingError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Unable to finish onboarding.";
}

function focusPortfolioListCollection(config: AppConfig, collectionId: string): AppConfig {
  const nextInstances = config.layout.instances.map((instance) => {
    if (instance.paneId !== "portfolio-list") {
      return instance;
    }

    const visibleCollectionIds = Array.isArray(instance.settings?.visibleCollectionIds)
      ? instance.settings.visibleCollectionIds.filter((value): value is string => typeof value === "string")
      : [];

    return {
      ...instance,
      params: {
        ...instance.params,
        collectionId,
      },
      settings: {
        ...instance.settings,
        visibleCollectionIds: [collectionId, ...visibleCollectionIds.filter((value) => value !== collectionId)],
      },
    };
  });

  return {
    ...config,
    layout: {
      ...config.layout,
      instances: nextInstances,
    },
  };
}

export async function finishOnboarding({
  config,
  baseConfig,
  isBroker,
  selectedTheme,
  portfolioName,
  onComplete,
}: {
  config: AppConfig;
  baseConfig: AppConfig | null;
  isBroker: boolean;
  selectedTheme: string;
  portfolioName: string;
  onComplete: (config: AppConfig) => void | Promise<void>;
}) {
  if (isBroker && !baseConfig) {
    throw new Error("Connect and sync the broker before finishing onboarding.");
  }

  const updatedConfig: AppConfig = {
    ...(baseConfig ?? config),
    theme: selectedTheme,
    portfolios: isBroker
      ? (baseConfig ?? config).portfolios
      : [{ id: "main", name: portfolioName || "Main Portfolio", currency: "USD" }],
    disabledPlugins: [],
    onboardingComplete: true,
  };

  await saveConfig(updatedConfig);
  await Promise.resolve(onComplete(updatedConfig));
}

export function useOnboardingBrokerSync({
  config,
  brokerOptions,
  brokerValues,
  selectedBrokerId,
  pluginRegistry,
  nextStep,
  setEditingField,
  setPortfolioSub,
}: {
  config: AppConfig;
  brokerOptions: BrokerOption[];
  brokerValues: Record<string, Record<string, string>>;
  selectedBrokerId: string | null;
  pluginRegistry: PluginRegistry;
  nextStep: () => void;
  setEditingField: (editing: boolean) => void;
  setPortfolioSub: Dispatch<SetStateAction<PortfolioSub>>;
}) {
  const brokerSyncAttemptRef = useRef(0);
  const [isBrokerSyncing, setIsBrokerSyncing] = useState(false);
  const [brokerSyncError, setBrokerSyncError] = useState<string | null>(null);
  const [brokerSyncedConfig, setBrokerSyncedConfig] = useState<AppConfig | null>(null);
  const [brokerSyncSummary, setBrokerSyncSummary] = useState<BrokerSyncSummary | null>(null);

  const resetBrokerSync = useCallback(() => {
    brokerSyncAttemptRef.current += 1;
    setIsBrokerSyncing(false);
    setBrokerSyncError(null);
    setBrokerSyncedConfig(null);
    setBrokerSyncSummary(null);
  }, []);

  const buildDraftBrokerConfig = useCallback((brokerValueOverrides?: Record<string, string>) => {
    const selectedValues = selectedBrokerId ? (brokerValueOverrides ?? brokerValues[selectedBrokerId]) : null;
    if (!selectedBrokerId || selectedBrokerId === "manual" || !selectedValues) {
      throw new Error("Broker setup is incomplete.");
    }

    const brokerOption = brokerOptions.find((option) => option.id === selectedBrokerId);
    const adapter = brokerOption?.adapter;
    if (!adapter) throw new Error(`Unknown broker "${selectedBrokerId}".`);
    const validationError = validateBrokerProfileValues(adapter, selectedValues);
    if (validationError) throw new Error(validationError);

    const label = brokerOption?.name || selectedBrokerId;
    const brokerConfig = buildBrokerProfileConfig(adapter, selectedValues);
    const instanceId = createBrokerInstanceId(
      selectedBrokerId,
      label,
      config.brokerInstances.map((instance) => instance.id),
    );

    return {
      instanceId,
      config: {
        ...config,
        brokerInstances: [
          ...config.brokerInstances,
          {
            id: instanceId,
            brokerType: selectedBrokerId,
            label,
            connectionMode: typeof brokerConfig.connectionMode === "string" ? brokerConfig.connectionMode : undefined,
            config: brokerConfig,
            enabled: true,
          },
        ],
      } satisfies AppConfig,
    };
  }, [brokerOptions, brokerValues, config, selectedBrokerId]);

  const syncSelectedBroker = useCallback(async (brokerValueOverrides?: Record<string, string>) => {
    const attemptId = brokerSyncAttemptRef.current + 1;
    brokerSyncAttemptRef.current = attemptId;
    setEditingField(false);
    setPortfolioSub("broker-sync");
    setIsBrokerSyncing(true);
    setBrokerSyncError(null);
    setBrokerSyncedConfig(null);
    setBrokerSyncSummary(null);

    try {
      const { config: draftConfig, instanceId } = buildDraftBrokerConfig(brokerValueOverrides);
      onboardingLog.info("Syncing broker during onboarding", { instanceId, brokerId: selectedBrokerId });
      const result = await syncBrokerInstance({
        config: draftConfig,
        instanceId,
        brokers: pluginRegistry.brokers,
        tickerRepository: pluginRegistry.tickerRepository,
        resources: pluginRegistry.persistence.resources,
        persistResolvedBrokerConfig: true,
      });
      if (brokerSyncAttemptRef.current !== attemptId) {
        return;
      }

      const portfolioId = result.portfolioIds[0] ?? null;
      const nextConfig = portfolioId
        ? focusPortfolioListCollection(result.config, portfolioId)
        : result.config;
      setBrokerSyncedConfig(nextConfig);
      setBrokerSyncSummary({
        portfolioId,
        positionsImported: result.positions.length,
      });
      setBrokerSyncError(null);
      setIsBrokerSyncing(false);
      setPortfolioSub("broker-fields");
      onboardingLog.info("Broker onboarding sync completed", {
        instanceId,
        portfolioId,
        positionsImported: result.positions.length,
      });
      nextStep();
    } catch (error) {
      if (brokerSyncAttemptRef.current !== attemptId) {
        return;
      }

      onboardingLog.error("Broker onboarding sync failed", { error: summarizeOnboardingError(error), brokerId: selectedBrokerId });
      setBrokerSyncError(summarizeOnboardingError(error));
      setIsBrokerSyncing(false);
      setPortfolioSub("broker-sync");
    }
  }, [
    buildDraftBrokerConfig,
    nextStep,
    pluginRegistry.brokers,
    pluginRegistry.persistence.resources,
    pluginRegistry.tickerRepository,
    selectedBrokerId,
    setEditingField,
    setPortfolioSub,
  ]);

  return {
    isBrokerSyncing,
    brokerSyncError,
    brokerSyncedConfig,
    brokerSyncSummary,
    resetBrokerSync,
    syncSelectedBroker,
  };
}
