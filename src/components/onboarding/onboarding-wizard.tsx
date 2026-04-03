import { useState, useCallback, useEffect, useRef, useMemo, type RefObject } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { colors, applyTheme } from "../../theme/colors";
import { themes, getThemeIds } from "../../theme/themes";
import { saveConfig } from "../../data/config-store";
import type { AppConfig } from "../../types/config";
import type { PluginRegistry } from "../../plugins/registry";
import { resolveBrokerConfigFields, type BrokerAdapter, type BrokerConfigField } from "../../types/broker";
import { buildIbkrConfigFromValues } from "../../plugins/ibkr/config";
import { createBrokerInstanceId } from "../../utils/broker-instances";
import { syncBrokerInstance } from "../../brokers/sync-broker-instance";
import { debugLog } from "../../utils/debug-log";
import { ToggleList, type ToggleListItem } from "../toggle-list";
import { TextField, ExternalLink } from "../ui";

interface OnboardingWizardProps {
  config: AppConfig;
  pluginRegistry: PluginRegistry;
  onComplete: (config: AppConfig) => void | Promise<void>;
}

type Step = "welcome" | "theme" | "portfolio" | "plugins" | "shortcuts" | "ready";
const STEPS: Step[] = ["welcome", "theme", "portfolio", "plugins", "shortcuts", "ready"];

// Sub-steps within the portfolio step
type PortfolioSub = "choose" | "manual-name" | "broker-setup" | "broker-fields" | "broker-sync";

interface BrokerOption {
  id: string;
  name: string;
  adapter: BrokerAdapter;
}

const LOGO = [
  "\u259E\u2580\u2596\u259C           \u258C        \u258C  ",
  "\u258C\u2584\u2596\u2590 \u259E\u2580\u2596\u259E\u2580\u2596\u259B\u259A\u2580\u2596\u259B\u2580\u2596\u259E\u2580\u2596\u2599\u2580\u2596\u259B\u2580\u2596",
  "\u258C \u258C\u2590 \u258C \u258C\u258C \u258C\u258C\u2590 \u258C\u258C \u258C\u259B\u2580 \u258C  \u258C \u258C",
  "\u259D\u2580  \u2598\u259D\u2580 \u259D\u2580 \u2598\u259D \u2598\u2580\u2580 \u259D\u2580\u2598\u2598  \u2580\u2580 ",
];

const PASSWORD_MASK_CHAR = "*";
const onboardingLog = debugLog.createLogger("onboarding");

interface BrokerSyncSummary {
  portfolioId: string | null;
  positionsImported: number;
}

function getToggleablePlugins(pluginRegistry: PluginRegistry) {
  const result: Array<{ id: string; name: string; description: string; order: number }> = [];
  for (const [, plugin] of pluginRegistry.allPlugins) {
    if (plugin.toggleable) {
      result.push({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description ?? "",
        order: plugin.order ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }
  return result
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .map(({ order: _order, ...plugin }) => plugin);
}

function summarizeError(error: unknown): string {
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
        lockedCollectionId: collectionId,
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

export function OnboardingWizard({ config, pluginRegistry, onComplete }: OnboardingWizardProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [step, setStep] = useState<Step>("welcome");
  const [themeIdx, setThemeIdx] = useState(0);

  // Portfolio state
  const [portfolioSub, setPortfolioSub] = useState<PortfolioSub>("choose");
  const [portfolioOptionIdx, setPortfolioOptionIdx] = useState(0);
  const [portfolioName, setPortfolioName] = useState("Main Portfolio");
  // Broker credentials: brokerId -> { field_key -> value }
  const [brokerValues, setBrokerValues] = useState<Record<string, Record<string, string>>>({});
  const [selectedBrokerId, setSelectedBrokerId] = useState<string | null>(null);
  const [brokerFieldIdx, setBrokerFieldIdx] = useState(0);
  const [brokerSelectIdx, setBrokerSelectIdx] = useState(0);
  const [editingField, setEditingField] = useState(false);
  const [isBrokerSyncing, setIsBrokerSyncing] = useState(false);
  const [brokerSyncError, setBrokerSyncError] = useState<string | null>(null);
  const [brokerSyncedConfig, setBrokerSyncedConfig] = useState<AppConfig | null>(null);
  const [brokerSyncSummary, setBrokerSyncSummary] = useState<BrokerSyncSummary | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // Plugin state
  const toggleablePlugins = useMemo(() => getToggleablePlugins(pluginRegistry), [pluginRegistry]);
  const [disabledPlugins, setDisabledPlugins] = useState<string[]>(() => (
    config.disabledPlugins.filter((pluginId) => pluginId !== "gloomberb-cloud")
  ));
  const [pluginIdx, setPluginIdx] = useState(0);

  const inputRef = useRef<InputRenderable>(null);
  const brokerSyncAttemptRef = useRef(0);
  const themeIds = getThemeIds();
  const stepIdx = STEPS.indexOf(step);

  // Discover connectable brokers from plugin registry (those with config fields)
  const brokerOptions = useMemo((): BrokerOption[] => {
    const options: BrokerOption[] = [];
    for (const [id, adapter] of pluginRegistry.brokers) {
      if (adapter.configSchema.length > 0) {
        options.push({ id, name: adapter.name, adapter });
      }
    }
    return options;
  }, [pluginRegistry.brokers]);

  // Build the list of choices for the portfolio step: manual + all connectable brokers
  const portfolioChoices = useMemo(() => {
    const choices: Array<{ id: string; label: string; desc: string }> = [
      { id: "manual", label: "Create Manual Portfolio", desc: "Add tickers and positions by hand" },
    ];
    for (const broker of brokerOptions) {
      choices.push({
        id: broker.id,
        label: `Connect ${broker.name}`,
        desc: `Auto-import positions via ${broker.name}`,
      });
    }
    return choices;
  }, [brokerOptions]);

  // Get the currently selected broker's required fields
  const activeBrokerFields = useMemo((): BrokerConfigField[] => {
    if (!selectedBrokerId) return [];
    const broker = brokerOptions.find((b) => b.id === selectedBrokerId);
    return broker
      ? resolveBrokerConfigFields(broker.adapter, brokerValues[selectedBrokerId] ?? {}).filter((field) => field.required)
      : [];
  }, [selectedBrokerId, brokerOptions, brokerValues]);

  // Apply theme preview synchronously so colors are correct for this render
  if (step === "theme") {
    applyTheme(themeIds[themeIdx]!);
  }

  // Focus input when entering editing mode
  useEffect(() => {
    if (editingField) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [editingField, portfolioSub, brokerFieldIdx]);

  useEffect(() => {
    if (!selectedBrokerId) return;
    const field = activeBrokerFields[brokerFieldIdx];
    if (!field || field.type !== "select") return;
    const currentValue = brokerValues[selectedBrokerId]?.[field.key] ?? field.options?.[0]?.value ?? "";
    const index = Math.max(0, field.options?.findIndex((option) => option.value === currentValue) ?? 0);
    setBrokerSelectIdx(index);
  }, [selectedBrokerId, brokerFieldIdx, activeBrokerFields, brokerValues]);

  useEffect(() => {
    if (step !== "ready" && finishError) {
      setFinishError(null);
    }
  }, [finishError, step]);

  const nextStep = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      setEditingField(false);
      setStep(STEPS[idx + 1]!);
    }
  }, [step]);

  const prevStep = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) {
      setStep(STEPS[idx - 1]!);
    }
  }, [step]);

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
    const label = brokerOption?.name || selectedBrokerId;
    const brokerConfig = (selectedBrokerId === "ibkr"
      ? buildIbkrConfigFromValues(selectedValues)
      : { ...selectedValues }) as unknown as Record<string, unknown>;
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
        persistResolvedIbkrConnection: true,
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

      onboardingLog.error("Broker onboarding sync failed", { error: summarizeError(error), brokerId: selectedBrokerId });
      setBrokerSyncError(summarizeError(error));
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
  ]);

  const finish = useCallback(async () => {
    if (isFinishing) {
      return;
    }

    setFinishError(null);
    const selectedTheme = themeIds[themeIdx]!;
    applyTheme(selectedTheme);

    const isBroker = selectedBrokerId && selectedBrokerId !== "manual";
    const baseConfig = isBroker ? brokerSyncedConfig : config;

    setIsFinishing(true);
    try {
      if (isBroker && !baseConfig) {
        throw new Error("Connect and sync the broker before finishing onboarding.");
      }

      const updatedConfig: AppConfig = {
        ...(baseConfig ?? config),
        theme: selectedTheme,
        portfolios: isBroker
          ? (baseConfig ?? config).portfolios
          : [{ id: "main", name: portfolioName || "Main Portfolio", currency: "USD" }],
        disabledPlugins,
        onboardingComplete: true,
      };

      await saveConfig(updatedConfig);
      await Promise.resolve(onComplete(updatedConfig));
    } catch (error) {
      setFinishError(summarizeError(error));
      setIsFinishing(false);
    }
  }, [
    brokerSyncedConfig,
    config,
    disabledPlugins,
    isFinishing,
    onComplete,
    portfolioName,
    selectedBrokerId,
    themeIds,
    themeIdx,
  ]);

  // Helper to update a broker field value
  const setBrokerFieldValue = useCallback((brokerId: string, key: string, value: string) => {
    resetBrokerSync();
    setBrokerValues((prev) => ({
      ...prev,
      [brokerId]: { ...prev[brokerId], [key]: value },
    }));
  }, [resetBrokerSync]);

  useKeyboard((event) => {
    if (isFinishing) {
      return;
    }

    // --- Input field handling ---
    if (editingField) {
      if (event.name === "return") {
        setEditingField(false);
        if (portfolioSub === "manual-name") {
          nextStep();
        } else if (portfolioSub === "broker-fields" && selectedBrokerId) {
          const currentField = activeBrokerFields[brokerFieldIdx];
          if (!currentField) {
            void syncSelectedBroker();
            return;
          }
          const rawValue = brokerValues[selectedBrokerId]?.[currentField.key] ?? "";
          const currentValue = rawValue.trim() || currentField.defaultValue || "";
          if (currentValue) {
            const nextValues = {
              ...(brokerValues[selectedBrokerId] ?? {}),
              [currentField.key]: currentValue,
            };
            if (!rawValue.trim() && currentField.defaultValue) {
              setBrokerFieldValue(selectedBrokerId, currentField.key, currentField.defaultValue);
            }
            // Move to next field, or advance to next step if all fields done
            if (brokerFieldIdx < activeBrokerFields.length - 1) {
              const nextIndex = brokerFieldIdx + 1;
              const nextField = activeBrokerFields[nextIndex];
              setBrokerFieldIdx(nextIndex);
              setEditingField(nextField?.type !== "select");
            } else {
              void syncSelectedBroker(nextValues);
            }
          }
        }
      } else if (event.name === "escape") {
        setEditingField(false);
        if (portfolioSub === "broker-fields") {
          setPortfolioSub("broker-setup");
        } else {
          setPortfolioSub("choose");
          setBrokerFieldIdx(0);
        }
      }
      return; // Let input handle other keys
    }

    // --- Global nav ---
    if (event.name === "return" || event.name === "enter") {
      if (step === "ready") {
        void finish();
        return;
      }
      if (step === "portfolio") {
        if (portfolioSub === "choose") {
          const choice = portfolioChoices[portfolioOptionIdx]!;
          if (choice.id === "manual") {
            resetBrokerSync();
            setSelectedBrokerId(null);
            setPortfolioSub("manual-name");
            setEditingField(true);
          } else {
            resetBrokerSync();
            setSelectedBrokerId(choice.id);
            setBrokerFieldIdx(0);
            setPortfolioSub("broker-fields");
            const broker = brokerOptions.find((option) => option.id === choice.id);
            const initialField = broker
              ? resolveBrokerConfigFields(broker.adapter, brokerValues[choice.id] ?? {}).filter((field) => field.required)[0]
              : null;
            setEditingField(initialField?.type !== "select");
          }
          return;
        }
        if (portfolioSub === "broker-setup" && selectedBrokerId) {
          setPortfolioSub("broker-fields");
          const currentField = activeBrokerFields[brokerFieldIdx];
          setEditingField(currentField?.type !== "select");
          return;
        }
        if (portfolioSub === "broker-fields" && selectedBrokerId) {
          const currentField = activeBrokerFields[brokerFieldIdx];
          if (!currentField) {
            void syncSelectedBroker();
            return;
          }
          if (currentField.type === "select") {
            const option = currentField.options?.[brokerSelectIdx];
            if (!option) return;
            setBrokerFieldValue(selectedBrokerId, currentField.key, option.value);
            const nextValues = {
              ...(brokerValues[selectedBrokerId] ?? {}),
              [currentField.key]: option.value,
            };
            const broker = brokerOptions.find((entry) => entry.id === selectedBrokerId);
            const fields = broker
              ? resolveBrokerConfigFields(broker.adapter, nextValues).filter((field) => field.required)
              : activeBrokerFields;
            if (brokerFieldIdx < fields.length - 1) {
              const nextIndex = brokerFieldIdx + 1;
              const nextField = fields[nextIndex];
              setBrokerFieldIdx(nextIndex);
              // Show setup guide after connection mode is selected
              if (currentField.key === "connectionMode") {
                setPortfolioSub("broker-setup");
              } else {
                setEditingField(nextField?.type !== "select");
              }
            } else {
              void syncSelectedBroker(nextValues);
            }
            return;
          }
          if (!editingField) {
            setEditingField(true);
            return;
          }
        }
        if (portfolioSub === "broker-sync") {
          if (!isBrokerSyncing && brokerSyncError) {
            void syncSelectedBroker();
          }
          return;
        }
      }
      nextStep();
    } else if (event.name === "escape") {
      if (step === "portfolio" && portfolioSub === "broker-sync") {
        resetBrokerSync();
        setPortfolioSub("broker-fields");
        return;
      }
      if (step === "portfolio" && portfolioSub === "broker-fields") {
        setPortfolioSub("broker-setup");
        return;
      }
      if (step === "portfolio" && portfolioSub === "broker-setup") {
        setPortfolioSub("broker-fields");
        setBrokerFieldIdx(0);
        return;
      }
      if (step === "portfolio" && portfolioSub !== "choose") {
        setPortfolioSub("choose");
        setBrokerFieldIdx(0);
        return;
      }
      prevStep();
    } else if (event.name === "left") {
      if (step === "portfolio" && portfolioSub === "broker-sync") {
        resetBrokerSync();
        setPortfolioSub("broker-fields");
        return;
      }
      if (step === "portfolio" && portfolioSub === "broker-fields") {
        setPortfolioSub("broker-setup");
        return;
      }
      if (step === "portfolio" && portfolioSub === "broker-setup") {
        setPortfolioSub("broker-fields");
        setBrokerFieldIdx(0);
        return;
      }
      if (step === "portfolio" && portfolioSub !== "choose") {
        setPortfolioSub("choose");
        setBrokerFieldIdx(0);
        return;
      }
      prevStep();
    } else if (event.name === "right") {
      nextStep();
    }

    // --- Step-specific controls ---
    if (step === "theme") {
      if (event.name === "up" || event.name === "k") {
        setThemeIdx((i) => Math.max(0, i - 1));
      } else if (event.name === "down" || event.name === "j") {
        setThemeIdx((i) => Math.min(themeIds.length - 1, i + 1));
      }
    } else if (step === "portfolio" && portfolioSub === "choose") {
      if (event.name === "up" || event.name === "k") {
        setPortfolioOptionIdx((i) => Math.max(0, i - 1));
      } else if (event.name === "down" || event.name === "j") {
        setPortfolioOptionIdx((i) => Math.min(portfolioChoices.length - 1, i + 1));
      }
    } else if (step === "portfolio" && portfolioSub === "broker-fields" && selectedBrokerId) {
      const currentField = activeBrokerFields[brokerFieldIdx];
      if (currentField?.type === "select") {
        const optionCount = currentField.options?.length ?? 0;
        if (event.name === "up" || event.name === "k") {
          setBrokerSelectIdx((index) => Math.max(0, index - 1));
        } else if (event.name === "down" || event.name === "j") {
          setBrokerSelectIdx((index) => Math.min(optionCount - 1, index + 1));
        }
      }
    } else if (step === "plugins") {
      if (event.name === "up" || event.name === "k") {
        setPluginIdx((i) => Math.max(0, i - 1));
      } else if (event.name === "down" || event.name === "j") {
        setPluginIdx((i) => Math.min(toggleablePlugins.length - 1, i + 1));
      } else if (event.name === "space" || event.name === " ") {
        event.stopPropagation?.();
        const plugin = toggleablePlugins[pluginIdx];
        if (plugin) {
          setDisabledPlugins((prev) =>
            prev.includes(plugin.id)
              ? prev.filter((id) => id !== plugin.id)
              : [...prev, plugin.id]
          );
        }
      }
    }
  });

  const contentWidth = Math.min(60, termWidth - 4);
  const contentLeft = Math.floor((termWidth - contentWidth) / 2);
  const contentTop = Math.max(1, Math.floor((termHeight - 24) / 2));

  // Progress bar
  const progressDots = STEPS.map((s, i) => {
    if (i < stepIdx) return "\u2501";
    if (i === stepIdx) return "\u25cf";
    return "\u00b7";
  }).join(" ");

  // Bottom hint text
  let hintText = "enter ->";
  if (step === "ready") {
    hintText = "enter to launch";
  }
  if (step === "portfolio" && portfolioSub === "broker-sync") {
    hintText = isBrokerSyncing ? "syncing broker..." : "enter to retry";
  } else if (isFinishing) {
    hintText = "launching...";
  }

  // Determine what the ready step should show
  const connectedBrokerName = selectedBrokerId
    ? brokerOptions.find((b) => b.id === selectedBrokerId)?.name
    : null;

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width={termWidth}
      height={termHeight}
      backgroundColor={colors.bg}
      zIndex={200}
    >
      <box
        position="absolute"
        top={contentTop}
        left={contentLeft}
        width={contentWidth}
        flexDirection="column"
      >
        {step === "welcome" && <WelcomeStep />}
        {step === "theme" && <ThemeStep themeIds={themeIds} selectedIdx={themeIdx} height={termHeight - contentTop - 4} />}
        {step === "portfolio" && (
          <PortfolioStep
            sub={portfolioSub}
            choices={portfolioChoices}
            optionIdx={portfolioOptionIdx}
            portfolioName={portfolioName}
            onNameChange={setPortfolioName}
            selectedBrokerId={selectedBrokerId}
            brokerFields={activeBrokerFields}
            brokerFieldIdx={brokerFieldIdx}
            brokerSelectIdx={brokerSelectIdx}
            brokerValues={brokerValues}
            onBrokerFieldChange={setBrokerFieldValue}
            editing={editingField}
            inputRef={inputRef}
            brokerSyncing={isBrokerSyncing}
            brokerSyncError={brokerSyncError}
          />
        )}
        {step === "plugins" && (
          <PluginsStep
            plugins={toggleablePlugins}
            disabledPlugins={disabledPlugins}
            selectedIdx={pluginIdx}
            onToggle={(id) => {
              setDisabledPlugins((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              );
            }}
            onSelect={setPluginIdx}
          />
        )}
        {step === "shortcuts" && (
          <ShortcutsStep pluginRegistry={pluginRegistry} disabledPlugins={disabledPlugins} />
        )}
        {step === "ready" && (
          <ReadyStep
            brokerName={connectedBrokerName ?? null}
            portfolioName={portfolioName}
            brokerSyncSummary={brokerSyncSummary}
            isFinishing={isFinishing}
            error={finishError}
          />
        )}

        {/* Bottom: progress + nav hints */}
        <box height={1} />
        <box height={1} flexDirection="row" width={contentWidth}>
          <box flexGrow={1}>
            <text fg={colors.textMuted}>{progressDots}</text>
          </box>
        </box>
        <box height={1} flexDirection="row" width={contentWidth}>
          <box flexGrow={1}>
            {stepIdx > 0 && <text fg={colors.textMuted}>{"<- back"}</text>}
          </box>
          <box>
            <text fg={colors.textMuted}>{hintText}</text>
          </box>
        </box>
      </box>
    </box>
  );
}

// --- Step Components ---

function WelcomeStep() {
  return (
    <box flexDirection="column" paddingX={2}>
      <box height={1} />
      {LOGO.map((line, i) => (
        <box key={i} height={1}>
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{line}</text>
        </box>
      ))}
      <box height={2} />
      <box height={1}>
        <text fg={colors.textDim}>{"The open terminal for modern finance."}</text>
      </box>
      <box height={2} />
      <box height={1}>
        <text fg={colors.textMuted}>{"Let's set things up (~30s)."}</text>
      </box>
      <box height={2} />

    </box>
  );
}

function ThemeStep({ themeIds, selectedIdx, height }: { themeIds: string[]; selectedIdx: number; height: number }) {
  const maxVisible = Math.min(themeIds.length, Math.max(6, height - 12));
  const halfWindow = Math.floor(maxVisible / 2);
  let windowStart = Math.max(0, Math.min(selectedIdx - halfWindow, themeIds.length - maxVisible));
  if (windowStart < 0) windowStart = 0;
  const windowEnd = Math.min(themeIds.length, windowStart + maxVisible);

  return (
    <box flexDirection="column" paddingX={2}>
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Theme"}</text>
      </box>
      <box height={1} />
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"Change it later from the command bar with "}</text>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{"TH"}</text>
      </box>
      <box height={1} />
      <box height={1}>
        <text fg={colors.positive}>{" \u2588\u2588 "}</text>
        <text fg={colors.negative}>{" \u2588\u2588 "}</text>
        <text fg={colors.text}>{" \u2588\u2588 "}</text>
        <text fg={colors.textBright}>{" \u2588\u2588 "}</text>
        <text fg={colors.borderFocused}>{" \u2588\u2588 "}</text>
        <text fg={colors.textDim}>{" \u2588\u2588 "}</text>
      </box>
      <box height={1} />

      {windowStart > 0 && (
        <box height={1}>
          <text fg={colors.textMuted}>{"\u2191 more"}</text>
        </box>
      )}

      {themeIds.slice(windowStart, windowEnd).map((id, i) => {
        const theme = themes[id]!;
        const globalIdx = windowStart + i;
        const isSel = globalIdx === selectedIdx;
        return (
          <box key={id} height={1} backgroundColor={isSel ? colors.selected : colors.bg}>
            <text fg={isSel ? colors.selectedText : colors.textDim}>
              {isSel ? "\u25b8 " : "  "}
            </text>
            <text fg={isSel ? colors.text : colors.textDim} attributes={isSel ? TextAttributes.BOLD : 0}>
              {theme.name}
            </text>
          </box>
        );
      })}

      {windowEnd < themeIds.length && (
        <box height={1}>
          <text fg={colors.textMuted}>{"\u2193 more"}</text>
        </box>
      )}

      <box height={1} />
      <box height={1}>
        <text fg={colors.textMuted}>{"Use \u2191\u2193 to browse"}</text>
      </box>
    </box>
  );
}

function PortfolioStep({
  sub,
  choices,
  optionIdx,
  portfolioName,
  onNameChange,
  selectedBrokerId,
  brokerFields,
  brokerFieldIdx,
  brokerSelectIdx,
  brokerValues,
  onBrokerFieldChange,
  editing,
  inputRef,
  brokerSyncing,
  brokerSyncError,
}: {
  sub: PortfolioSub;
  choices: Array<{ id: string; label: string; desc: string }>;
  optionIdx: number;
  portfolioName: string;
  onNameChange: (n: string) => void;
  selectedBrokerId: string | null;
  brokerFields: BrokerConfigField[];
  brokerFieldIdx: number;
  brokerSelectIdx: number;
  brokerValues: Record<string, Record<string, string>>;
  onBrokerFieldChange: (brokerId: string, key: string, value: string) => void;
  editing: boolean;
  inputRef: RefObject<InputRenderable | null>;
  brokerSyncing: boolean;
  brokerSyncError: string | null;
}) {
  if (sub === "choose") {
    return (
      <box flexDirection="column" paddingX={2}>
        <box height={1}>
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Set up a portfolio"}</text>
        </box>
        <box height={1} />
        <box height={1}>
          <text fg={colors.textDim}>{"How would you like to get started?"}</text>
        </box>
        <box height={2} />

        {choices.map((opt, i) => {
          const isSel = i === optionIdx;
          return (
            <box key={opt.id} height={1} backgroundColor={isSel ? colors.selected : colors.bg}>
              <text fg={isSel ? colors.selectedText : colors.textDim}>
                {isSel ? "\u25b8 " : "  "}
              </text>
              <text fg={isSel ? colors.text : colors.textDim} attributes={isSel ? TextAttributes.BOLD : 0}>
                {opt.label}
              </text>
            </box>
          );
        })}

        <box height={1} />
        <box height={1}>
          <text fg={colors.textDim}>{choices[optionIdx]?.desc}</text>
        </box>

        <box height={1} />
        <box height={1}>
          <text fg={colors.textDim}>{"Edits later from the command bar."}</text>
        </box>
        <box height={1} />
        <box height={1}>
          <text fg={colors.textMuted}>{"Use \u2191\u2193 to choose"}</text>
        </box>
      </box>
    );
  }

  if (sub === "manual-name") {
    return (
      <box flexDirection="column" paddingX={2}>
        <box height={1}>
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Name your portfolio"}</text>
        </box>
        <box height={1} />
        <box height={1}>
          <text fg={colors.textDim}>{"Create watchlists later."}</text>
        </box>
        <box height={2} />
        <box height={1}>
          <text fg={colors.text}>{"Portfolio name:"}</text>
        </box>
        <box height={1}>
          {editing ? (
            <TextField
              inputRef={inputRef}
              value={portfolioName}
              placeholder="Main Portfolio"
              focused
              backgroundColor={colors.panel}
              textColor={colors.text}
              placeholderColor={colors.textDim}
              onChange={onNameChange}
              onSubmit={() => {}}
            />
          ) : (
            <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
              {`> ${portfolioName}`}
            </text>
          )}
        </box>
        <box height={2} />
        <box height={1} flexDirection="row">
          <text fg={colors.textDim}>{"After setup, use the command bar ("}</text>
          <text fg={colors.text}>{"Ctrl+P"}</text>
          <text fg={colors.textDim}>{") and"}</text>
        </box>
        <box height={1} flexDirection="row">
          <text fg={colors.textDim}>{"type "}</text>
          <text fg={colors.text} attributes={TextAttributes.BOLD}>{"T AAPL"}</text>
          <text fg={colors.textDim}>{" to search and add any stock or ETF."}</text>
        </box>
      </box>
    );
  }

  if (sub === "broker-setup" && selectedBrokerId) {
    const brokerLabel = choices.find((c) => c.id === selectedBrokerId)?.label.replace("Connect ", "") ?? selectedBrokerId;
    const connectionMode = brokerValues[selectedBrokerId]?.connectionMode;
    const isGateway = connectionMode === "gateway";

    return (
      <box flexDirection="column" paddingX={2}>
        <box height={1}>
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {`Setup Guide — ${brokerLabel}`}
          </text>
        </box>
        <box height={1} />

        {selectedBrokerId === "ibkr" && !isGateway && (
          <>
            <box height={1}>
              <text fg={colors.textDim}>{"You'll need 2 things from IBKR Account Management:"}</text>
            </box>
            <box height={2} />
            <box height={1}>
              <text fg={colors.textDim}>{"1. Go to "}<u><span fg={colors.text}>{"Reports > Flex Queries"}</span></u></text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"2. Create a Flex Query that includes positions data"}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"3. Note the "}<strong><span fg={colors.text}>{"Query ID"}</span></strong>{" (numeric)"}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"4. Under "}<u><span fg={colors.text}>{"Reports > Settings"}</span></u>{", generate a "}<strong><span fg={colors.text}>{"Flex Web Service Token"}</span></strong></text>
            </box>
            <box height={2} />
            <ExternalLink url="https://www.ibkrguides.com/orgportal/performanceandstatements/flex.htm" />
          </>
        )}

        {selectedBrokerId === "ibkr" && isGateway && (
          <>
            <box height={1}>
              <text fg={colors.textDim}>{"You'll need IB Gateway or TWS running locally:"}</text>
            </box>
            <box height={2} />
            <box height={1}>
              <text fg={colors.textDim}>{"1. Download and install "}<strong><span fg={colors.text}>{"IB Gateway"}</span></strong>{" (or use TWS)"}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"2. Log in with your IBKR credentials"}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"3. In "}<u><span fg={colors.text}>{"Configuration > API > Settings"}</span></u>{":"}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"   Enable \"ActiveX and Socket Clients\""}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"   Gloomberb can auto-detect local API ports (4001, 4002, 7496, 7497)"}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"   Use Manual setup only if you need a custom host or exact socket port"}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"4. Keep it running while using Gloomberb"}</text>
            </box>
            <box height={2} />
            <ExternalLink url="https://www.interactivebrokers.com/en/trading/ibgateway-stable.php" />
          </>
        )}

        {selectedBrokerId !== "ibkr" && (
          <>
            <box height={1}>
              <text fg={colors.textDim}>{`You'll need your ${brokerLabel} API credentials.`}</text>
            </box>
            <box height={1}>
              <text fg={colors.textDim}>{"Check your broker's documentation for setup instructions."}</text>
            </box>
          </>
        )}

        <box height={2} />

      </box>
    );
  }

  if (sub === "broker-sync" && selectedBrokerId) {
    const brokerLabel = choices.find((choice) => choice.id === selectedBrokerId)?.label.replace("Connect ", "") ?? selectedBrokerId;
    return (
      <box flexDirection="column" paddingX={2}>
        <box height={1}>
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{`Connect ${brokerLabel}`}</text>
        </box>
        <box height={1} />
        <box height={1}>
          <text fg={brokerSyncing ? colors.text : colors.negative}>
            {brokerSyncing
              ? `Connecting to ${brokerLabel} and importing accounts and positions...`
              : brokerSyncError || `Unable to sync ${brokerLabel}.`}
          </text>
        </box>
        <box height={2} />
        <box height={1}>
          <text fg={colors.textDim}>
            {brokerSyncing
              ? "This happens now so your portfolio is ready before onboarding finishes."
              : "Press Enter to retry, or Esc to edit the broker settings."}
          </text>
        </box>
      </box>
    );
  }

  // broker-fields: dynamically render fields from the broker's configSchema
  if (!selectedBrokerId) return null;
  const currentField = brokerFields[brokerFieldIdx];
  const values = brokerValues[selectedBrokerId] ?? {};

  return (
    <box flexDirection="column" paddingX={2}>
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {"Connect "}{choices.find((c) => c.id === selectedBrokerId)?.label.replace("Connect ", "") ?? selectedBrokerId}
        </text>
      </box>
      <box height={1} />

      {/* Show completed fields */}
      {brokerFields.map((field, i) => {
        if (i > brokerFieldIdx) return null;
        const val = values[field.key] ?? "";
        const isActive = i === brokerFieldIdx;

        if (!isActive && val) {
          const selectedLabel = field.type === "select"
            ? field.options?.find((option) => option.value === val)?.label ?? val
            : field.type === "password" ? PASSWORD_MASK_CHAR.repeat(val.length) : val;
          return (
            <box key={field.key} height={1}>
              <text fg={colors.positive}>{"\u2713 "}</text>
              <text fg={colors.text}>{`${field.label}: ${selectedLabel}`}</text>
            </box>
          );
        }

        if (isActive) {
          const activeSelectValue = field.options?.[brokerSelectIdx]?.value ?? values[field.key] ?? "";
          const effectiveValue = val || field.defaultValue || "";
          return (
            <box key={field.key} flexDirection="column">
              {i > 0 && <box height={1} />}
              <box height={1}>
                <text fg={colors.text} attributes={TextAttributes.BOLD}>
                  {`Step ${i + 1}: `}
                </text>
                <text fg={colors.text}>{field.label}</text>
              </box>
              <box height={1}>
                {field.type !== "select" && (editing ? (
                  <TextField
                    inputRef={inputRef}
                    value={val}
                    type={field.type === "password" ? "password" : "text"}
                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    focused
                    backgroundColor={colors.panel}
                    textColor={colors.text}
                    placeholderColor={colors.textDim}
                    onChange={(nextValue) => onBrokerFieldChange(selectedBrokerId, field.key, nextValue)}
                    onSubmit={() => {}}
                  />
                ) : (
                  <text fg={effectiveValue ? colors.positive : colors.textMuted}>
                    {effectiveValue
                      ? `\u2713 ${field.label}: ${field.type === "password" ? PASSWORD_MASK_CHAR.repeat(effectiveValue.length) : effectiveValue}`
                      : "Press enter to type..."}
                  </text>
                ))}
              </box>
              {field.type !== "select" && !val && field.defaultValue && (
                <box height={1}>
                  <text fg={colors.textMuted}>{`Press enter to use ${field.defaultValue}`}</text>
                </box>
              )}
              {field.type === "select" && (
                <box flexDirection="column">
                  {(field.options ?? []).map((option, optionIdx) => {
                    const selected = optionIdx === brokerSelectIdx;
                    return (
                      <box key={option.value} flexDirection="column" backgroundColor={selected ? colors.selected : colors.bg}>
                        <box height={1}>
                          <text fg={selected ? colors.selectedText : colors.textDim}>{selected ? "\u25b8 " : "  "}</text>
                          <text
                            fg={selected ? colors.text : colors.textDim}
                            attributes={selected ? TextAttributes.BOLD : 0}
                          >
                            {option.label}
                          </text>
                        </box>
                        {option.description && (
                          <box height={1}>
                            <text fg={colors.textMuted}>{`  ${option.description}`}</text>
                          </box>
                        )}
                      </box>
                    );
                  })}
                </box>
              )}
              {field.type === "select" && (
                <box height={1}>
                  <text fg={colors.textMuted}>
                    {activeSelectValue ? `Selected: ${field.options?.find((option) => option.value === activeSelectValue)?.label ?? activeSelectValue}` : "Use \u2191\u2193 to choose"}
                  </text>
                </box>
              )}
            </box>
          );
        }

        return null;
      })}

      <box height={2} />
      <box height={1}>
        <text fg={colors.textDim}>{"Credentials are saved locally."}</text>
      </box>
      <box height={1} />
      <box height={1}>
        <text fg={colors.textMuted}>
          {`Field ${brokerFieldIdx + 1} of ${brokerFields.length}`}
        </text>
      </box>
    </box>
  );
}

function PluginsStep({
  plugins,
  disabledPlugins,
  selectedIdx,
  onToggle,
  onSelect,
}: {
  plugins: { id: string; name: string; description: string }[];
  disabledPlugins: string[];
  selectedIdx: number;
  onToggle: (id: string) => void;
  onSelect: (idx: number) => void;
}) {
  const items: ToggleListItem[] = plugins.map((p) => ({
    id: p.id,
    label: p.name,
    enabled: !disabledPlugins.includes(p.id),
    description: p.description,
  }));

  return (
    <box flexDirection="column" paddingX={2}>
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Select plugins to enable"}</text>
      </box>

      <box height={2} />

      <ToggleList
        items={items}
        selectedIdx={selectedIdx}
        onToggle={onToggle}
        onSelect={onSelect}
      />

      <box height={1} />
      <box height={1}>
        <text fg={colors.textMuted}>{"Use \u2191\u2193 to navigate \u00b7 space to toggle"}</text>
      </box>
      <box height={1} />
      <box height={1}>
        <text fg={colors.textDim}>{"Toggle plugins anytime from the command bar"}</text>
      </box>
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"with the "}</text>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{"PL"}</text>
        <text fg={colors.textDim}>{" prefix."}</text>
      </box>
    </box>
  );
}

function ShortcutsStep({
  pluginRegistry,
  disabledPlugins,
}: {
  pluginRegistry: PluginRegistry;
  disabledPlugins: string[];
}) {
  const keyboardShortcuts = [
    { key: "Ctrl+P / `", desc: "Open the command bar" },
    { key: "Tab", desc: "Switch between panels" },
    { key: "Ctrl+W", desc: "Close the current window" },
    { key: "q", desc: "Quit" },
  ];

  const disabledSet = useMemo(() => new Set(disabledPlugins), [disabledPlugins]);

  const commandPrefixes = useMemo(() => {
    const builtIn = [
      { key: "T AAPL", desc: "Search and add any ticker" },
      { key: "TH", desc: "Switch theme" },
      { key: "PL", desc: "Toggle plugins" },
      { key: "PS", desc: "Edit the current window settings" },
      { key: "HELP", desc: "Open the help window" },
    ];

    const builtInKeys = new Set(builtIn.map((b) => b.key.split(" ")[0]));
    const pluginPrefixes: { key: string; desc: string }[] = [];

    for (const [, template] of pluginRegistry.paneTemplates) {
      if (!template.shortcut) continue;
      const pluginId = pluginRegistry.getPaneTemplatePluginId(template.id);
      if (pluginId && disabledSet.has(pluginId)) continue;
      if (builtInKeys.has(template.shortcut.prefix)) continue;
      const label = template.shortcut.argPlaceholder
        ? `${template.shortcut.prefix} <${template.shortcut.argPlaceholder}>`
        : template.shortcut.prefix;
      pluginPrefixes.push({ key: label, desc: template.label });
    }

    pluginPrefixes.sort((a, b) => a.key.localeCompare(b.key));
    return [...builtIn, ...pluginPrefixes];
  }, [pluginRegistry, disabledSet]);

  const COL = 14;

  return (
    <box flexDirection="column" paddingX={2}>
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Useful shortcuts"}</text>
      </box>
      <box height={1} />

      {keyboardShortcuts.map((s) => (
        <box key={s.key} height={1} flexDirection="row">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>{s.key.padEnd(COL)}</text>
          <text fg={colors.textDim}>{s.desc}</text>
        </box>
      ))}

      <box height={2} />
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Command-bar prefixes"}</text>
      </box>
      <box height={1} />
      <box height={1}>
        <text fg={colors.textDim}>{"Type these in the command bar ("}<span fg={colors.text}><strong>{"Ctrl+P"}</strong></span>{" or "}<span fg={colors.text}><strong>{"`"}</strong></span>{"):"}</text>
      </box>
      <box height={1} />

      {commandPrefixes.map((s) => (
        <box key={s.key} height={1} flexDirection="row">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>{s.key.padEnd(COL)}</text>
          <text fg={colors.textDim}>{s.desc}</text>
        </box>
      ))}

      <box height={2} />
      <box height={1}>
        <text fg={colors.textDim}>{"Everything is searchable, just type what you want."}</text>
      </box>
    </box>
  );
}

function ReadyStep({
  brokerName,
  portfolioName,
  brokerSyncSummary,
  isFinishing,
  error,
}: {
  brokerName: string | null;
  portfolioName: string;
  brokerSyncSummary: BrokerSyncSummary | null;
  isFinishing: boolean;
  error: string | null;
}) {
  const positionsImported = brokerSyncSummary?.positionsImported ?? 0;
  const positionLabel = positionsImported === 1 ? "position" : "positions";

  return (
    <box flexDirection="column" paddingX={2}>
      <box height={2} />
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"You're all set"}</text>
      </box>
      <box height={2} />
      <box height={1}>
        <text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</text>
        <text fg={colors.text}>{" Theme configured"}</text>
      </box>
      <box height={1}>
        <text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</text>
        <text fg={colors.text}>
          {brokerName
            ? ` ${brokerName} connected. Imported ${positionsImported} ${positionLabel}`
            : ` Portfolio "${portfolioName}" created`}
        </text>
      </box>
      <box height={1}>
        <text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</text>
        <text fg={colors.text}>{" Plugins selected"}</text>
      </box>
      <box height={2} />
      {brokerName ? (
        <box height={1}>
          <text fg={isFinishing ? colors.text : colors.textDim}>
            {isFinishing
              ? "Launching Gloomberb..."
              : positionsImported > 0
              ? "Your broker portfolio is ready and will open directly after launch."
              : "Broker sync finished. If you expected holdings, check the selected account or connection mode."}
          </text>
        </box>
      ) : (
        <box height={1}>
          <text fg={colors.textDim}>{"Search for broker names in the command bar to connect."}</text>
        </box>
      )}
      {error && (
        <>
          <box height={1} />
          <box height={2}>
            <text fg={colors.negative}>{error}</text>
          </box>
        </>
      )}
      <box height={2} />
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"Data stored in "}</text>
        <text fg={colors.text}>{"~/gloomberb/"}</text>
      </box>
      <box height={1} />
    </box>
  );
}
