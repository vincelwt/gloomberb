import { useState, useCallback, useEffect, useRef, useMemo, type RefObject } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { colors, applyTheme } from "../../theme/colors";
import { themes, getThemeIds } from "../../theme/themes";
import { saveConfig } from "../../data/config-store";
import type { AppConfig } from "../../types/config";
import type { PluginRegistry } from "../../plugins/registry";
import type { BrokerAdapter, BrokerConfigField } from "../../types/broker";
import { ToggleList, type ToggleListItem } from "../toggle-list";

interface OnboardingWizardProps {
  config: AppConfig;
  pluginRegistry: PluginRegistry;
  onComplete: (config: AppConfig) => void;
}

type Step = "welcome" | "theme" | "portfolio" | "plugins" | "shortcuts" | "ready";
const STEPS: Step[] = ["welcome", "theme", "portfolio", "plugins", "shortcuts", "ready"];

// Sub-steps within the portfolio step
type PortfolioSub = "choose" | "manual-name" | "broker-fields";

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

function getToggleablePlugins(pluginRegistry: PluginRegistry) {
  const result: { id: string; name: string; description: string }[] = [];
  for (const [, plugin] of pluginRegistry.allPlugins) {
    if (plugin.toggleable) {
      result.push({ id: plugin.id, name: plugin.name, description: plugin.description ?? "" });
    }
  }
  return result;
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
  const [editingField, setEditingField] = useState(false);

  // Plugin state
  const toggleablePlugins = useMemo(() => getToggleablePlugins(pluginRegistry), [pluginRegistry]);
  const [disabledPlugins, setDisabledPlugins] = useState<string[]>([]);
  const [pluginIdx, setPluginIdx] = useState(0);

  const inputRef = useRef<InputRenderable>(null);
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
    return broker?.adapter.configSchema.filter((f) => f.required) ?? [];
  }, [selectedBrokerId, brokerOptions]);

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

  const finish = useCallback(() => {
    const selectedTheme = themeIds[themeIdx]!;
    applyTheme(selectedTheme);

    const isBroker = selectedBrokerId && selectedBrokerId !== "manual";

    // Build broker config from collected values
    const brokers = { ...config.brokers };
    if (isBroker && brokerValues[selectedBrokerId]) {
      brokers[selectedBrokerId] = { ...brokerValues[selectedBrokerId] };
    }

    const updatedConfig: AppConfig = {
      ...config,
      theme: selectedTheme,
      portfolios: isBroker
        ? config.portfolios // Broker plugins auto-create portfolios on sync
        : [{ id: "main", name: portfolioName || "Main Portfolio", currency: "USD" }],
      disabledPlugins,
      onboardingComplete: true,
      brokers,
    };
    saveConfig(updatedConfig).catch(() => {});
    onComplete(updatedConfig);
  }, [config, themeIdx, themeIds, portfolioName, selectedBrokerId, brokerValues, disabledPlugins, onComplete]);

  // Helper to update a broker field value
  const setBrokerFieldValue = useCallback((brokerId: string, key: string, value: string) => {
    setBrokerValues((prev) => ({
      ...prev,
      [brokerId]: { ...prev[brokerId], [key]: value },
    }));
  }, []);

  useKeyboard((event) => {
    // --- Input field handling ---
    if (editingField) {
      if (event.name === "return") {
        setEditingField(false);
        if (portfolioSub === "manual-name") {
          nextStep();
        } else if (portfolioSub === "broker-fields" && selectedBrokerId) {
          const currentField = activeBrokerFields[brokerFieldIdx];
          const currentValue = brokerValues[selectedBrokerId]?.[currentField?.key ?? ""] ?? "";
          if (currentValue.trim()) {
            // Move to next field, or advance to next step if all fields done
            if (brokerFieldIdx < activeBrokerFields.length - 1) {
              setBrokerFieldIdx(brokerFieldIdx + 1);
              setEditingField(true);
            } else {
              nextStep();
            }
          }
        }
      } else if (event.name === "escape") {
        setEditingField(false);
        if (portfolioSub === "broker-fields" && brokerFieldIdx > 0) {
          setBrokerFieldIdx(brokerFieldIdx - 1);
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
        finish();
        return;
      }
      if (step === "portfolio") {
        if (portfolioSub === "choose") {
          const choice = portfolioChoices[portfolioOptionIdx]!;
          if (choice.id === "manual") {
            setSelectedBrokerId(null);
            setPortfolioSub("manual-name");
            setEditingField(true);
          } else {
            setSelectedBrokerId(choice.id);
            setBrokerFieldIdx(0);
            setPortfolioSub("broker-fields");
            setEditingField(true);
          }
          return;
        }
      }
      nextStep();
    } else if (event.name === "escape") {
      if (step === "portfolio" && portfolioSub !== "choose") {
        setPortfolioSub("choose");
        setBrokerFieldIdx(0);
        return;
      }
      prevStep();
    } else if (event.name === "left") {
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
  let hintText = "enter to continue ->";
  if (step === "ready") hintText = "enter to launch";
  else if (step === "portfolio" && portfolioSub === "choose") hintText = "enter to select";
  else if (step === "portfolio" && editingField) hintText = "enter to confirm \u00b7 esc to go back";

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
            brokerValues={brokerValues}
            onBrokerFieldChange={setBrokerFieldValue}
            editing={editingField}
            inputRef={inputRef}
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
        {step === "shortcuts" && <ShortcutsStep />}
        {step === "ready" && (
          <ReadyStep
            brokerName={connectedBrokerName}
            portfolioName={portfolioName}
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
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{"Welcome to Gloomberb"}</text>
      </box>
      <box height={1} />
      <box height={1}>
        <text fg={colors.textDim}>{"A terminal for tracking your portfolio,"}</text>
      </box>
      <box height={1}>
        <text fg={colors.textDim}>{"watchlists, and markets."}</text>
      </box>
      <box height={2} />
      <box height={1}>
        <text fg={colors.textDim}>{"Everything is a plugin -- brokers, data sources,"}</text>
      </box>
      <box height={1}>
        <text fg={colors.textDim}>{"and UI panels are all swappable and extensible."}</text>
      </box>
      <box height={2} />
      <box height={1}>
        <text fg={colors.textMuted}>{"Let's set things up. This will take ~30 seconds."}</text>
      </box>
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
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Choose Your Theme"}</text>
      </box>
      <box height={1} />
      <box height={1}>
        <text fg={colors.textDim}>{"Pick a color scheme. You can always change it later"}</text>
      </box>
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"from the command bar with "}</text>
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
  brokerValues,
  onBrokerFieldChange,
  editing,
  inputRef,
}: {
  sub: PortfolioSub;
  choices: Array<{ id: string; label: string; desc: string }>;
  optionIdx: number;
  portfolioName: string;
  onNameChange: (n: string) => void;
  selectedBrokerId: string | null;
  brokerFields: BrokerConfigField[];
  brokerFieldIdx: number;
  brokerValues: Record<string, Record<string, string>>;
  onBrokerFieldChange: (brokerId: string, key: string, value: string) => void;
  editing: boolean;
  inputRef: RefObject<InputRenderable | null>;
}) {
  if (sub === "choose") {
    return (
      <box flexDirection="column" paddingX={2}>
        <box height={1}>
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Set Up Your Portfolio"}</text>
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
          <text fg={colors.textDim}>{"You can always add more brokers or portfolios"}</text>
        </box>
        <box height={1}>
          <text fg={colors.textDim}>{"later from the command bar."}</text>
        </box>
        <box height={1} />
        <box height={1}>
          <text fg={colors.textMuted}>{"Use \u2191\u2193 to choose \u00b7 enter to select"}</text>
        </box>
      </box>
    );
  }

  if (sub === "manual-name") {
    return (
      <box flexDirection="column" paddingX={2}>
        <box height={1}>
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Name Your Portfolio"}</text>
        </box>
        <box height={1} />
        <box height={1}>
          <text fg={colors.textDim}>{"A portfolio tracks your positions with cost basis."}</text>
        </box>
        <box height={1}>
          <text fg={colors.textDim}>{"You can create watchlists later for tickers you"}</text>
        </box>
        <box height={1}>
          <text fg={colors.textDim}>{"want to follow without holding."}</text>
        </box>
        <box height={2} />
        <box height={1}>
          <text fg={colors.text}>{"Portfolio name:"}</text>
        </box>
        <box height={1}>
          {editing ? (
            <input
              ref={inputRef}
              placeholder="Main Portfolio"
              focused
              textColor={colors.text}
              placeholderColor={colors.textDim}
              backgroundColor={colors.panel}
              onChange={(val) => onNameChange(val)}
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
          return (
            <box key={field.key} height={1}>
              <text fg={colors.positive}>{"\u2713 "}</text>
              <text fg={colors.text}>{field.label}</text>
            </box>
          );
        }

        if (isActive) {
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
                {editing ? (
                  <input
                    ref={inputRef}
                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    focused
                    textColor={colors.text}
                    placeholderColor={colors.textDim}
                    backgroundColor={colors.panel}
                    onChange={(val) => onBrokerFieldChange(selectedBrokerId, field.key, val)}
                    onSubmit={() => {}}
                  />
                ) : (
                  <text fg={val ? colors.positive : colors.textMuted}>
                    {val ? `\u2713 ${field.label} entered` : "Press enter to type..."}
                  </text>
                )}
              </box>
            </box>
          );
        }

        return null;
      })}

      <box height={2} />
      <box height={1}>
        <text fg={colors.textDim}>{"Your credentials will be saved and positions"}</text>
      </box>
      <box height={1}>
        <text fg={colors.textDim}>{"will sync automatically when Gloomberb starts."}</text>
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
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Enable Plugins"}</text>
      </box>
      <box height={1} />
      <box height={1}>
        <text fg={colors.textDim}>{"Core features are plugins too. These optional"}</text>
      </box>
      <box height={1}>
        <text fg={colors.textDim}>{"ones add extra functionality:"}</text>
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
        <text fg={colors.textDim}>{"You can toggle plugins anytime from the command bar"}</text>
      </box>
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"with the "}</text>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{"PL"}</text>
        <text fg={colors.textDim}>{" prefix."}</text>
      </box>
    </box>
  );
}

function ShortcutsStep() {
  const shortcuts = [
    { key: "Ctrl+P / `  ", desc: "Open the command bar" },
    { key: "Tab         ", desc: "Switch between panels" },
    { key: "T AAPL      ", desc: "Search and add any ticker" },
    { key: "TH          ", desc: "Switch theme" },
    { key: "PL          ", desc: "Toggle plugins" },
    { key: "COL         ", desc: "Configure visible columns" },
    { key: "r / R       ", desc: "Refresh selected / all tickers" },
    { key: "q           ", desc: "Quit" },
  ];

  return (
    <box flexDirection="column" paddingX={2}>
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"The Command Bar"}</text>
      </box>
      <box height={1} />
      <box height={1}>
        <text fg={colors.textDim}>{"The command bar is your main way to interact"}</text>
      </box>
      <box height={1}>
        <text fg={colors.textDim}>{"with Gloomberb. Open it anytime with:"}</text>
      </box>
      <box height={2} />
      <box height={1} paddingX={2}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Ctrl+P  or  ` (backtick)"}</text>
      </box>
      <box height={2} />
      <box height={1}>
        <text fg={colors.textDim}>{"It supports prefix shortcuts for quick access:"}</text>
      </box>
      <box height={1} />

      {shortcuts.map((s) => (
        <box key={s.key} height={1} flexDirection="row">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>{s.key}</text>
          <text fg={colors.textDim}>{s.desc}</text>
        </box>
      ))}

      <box height={2} />
      <box height={1}>
        <text fg={colors.textDim}>{"Everything is searchable -- just type what you want."}</text>
      </box>
    </box>
  );
}

function ReadyStep({ brokerName, portfolioName }: { brokerName: string | null; portfolioName: string }) {
  return (
    <box flexDirection="column" paddingX={2}>
      <box height={2} />
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"You're All Set"}</text>
      </box>
      <box height={2} />
      <box height={1}>
        <text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</text>
        <text fg={colors.text}>{" Theme configured"}</text>
      </box>
      <box height={1}>
        <text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</text>
        <text fg={colors.text}>
          {brokerName ? ` ${brokerName} connected -- positions will sync on launch` : ` Portfolio "${portfolioName}" created`}
        </text>
      </box>
      <box height={1}>
        <text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</text>
        <text fg={colors.text}>{" Plugins selected"}</text>
      </box>
      <box height={2} />
      <box height={1}>
        <text fg={colors.textDim}>{"Quick tips to get started:"}</text>
      </box>
      <box height={1} />
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"\u2022 Press "}</text>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{"Ctrl+P"}</text>
        <text fg={colors.textDim}>{" to open the command bar"}</text>
      </box>
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"\u2022 Type "}</text>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{"T AAPL"}</text>
        <text fg={colors.textDim}>{" to add your first ticker"}</text>
      </box>
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"\u2022 Use "}</text>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{"Tab"}</text>
        <text fg={colors.textDim}>{" to switch between panels"}</text>
      </box>
      {!brokerName && (
        <box height={1}>
          <text fg={colors.textDim}>{"\u2022 Search for broker names in the command bar to connect"}</text>
        </box>
      )}
      <box height={2} />
      <box height={1} flexDirection="row">
        <text fg={colors.textDim}>{"Gloomberb stores data in "}</text>
        <text fg={colors.text}>{"~/gloomberb-data/"}</text>
      </box>
      <box height={1}>
        <text fg={colors.textDim}>{"Everything is plain files -- easy to back up,"}</text>
      </box>
      <box height={1}>
        <text fg={colors.textDim}>{"version control, or script against."}</text>
      </box>
      <box height={3} />
      <box height={1}>
        <text fg={colors.borderFocused} attributes={TextAttributes.BOLD}>{"Press Enter to launch Gloomberb \u25b8"}</text>
      </box>
    </box>
  );
}
