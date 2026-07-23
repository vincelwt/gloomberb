import { describe, expect, test } from "bun:test";
import type { PaneSettingActionContext } from "../../../types/plugin";
import {
  AI_DEFAULT_MODEL_SETTING_KEY,
  AI_DEFAULT_PROVIDER_SETTING_KEY,
  buildAiPaneSettingsDef,
  resolveAiPaneSelection,
  resolveAiSharedDefaults,
} from "./pane-settings";

const providers = [
  { id: "anthropic", label: "Claude" },
  { id: "openai-codex", label: "OpenAI" },
];

const models = [
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5", providerId: "anthropic" },
  { id: "gpt-5.4", label: "GPT-5.4", providerId: "openai-codex" },
];

describe("shared AI pane settings", () => {
  test("composes global defaults, pane overrides, accounts, and pane-specific fields", async () => {
    const actions: string[] = [];
    const definition = buildAiPaneSettingsDef({
      title: "AI Screener Settings",
      providers,
      models,
      defaultProviderId: "anthropic",
      defaultModelId: "claude-sonnet-4-5",
      paneOverride: {
        providerId: null,
        modelId: "claude-custom",
      },
      accountRows: [{
        providerId: "anthropic",
        providerLabel: "Claude",
        description: "Connected as vince@example.com",
        actionLabel: "Manage",
        action: () => { actions.push("anthropic"); },
      }],
      manageAccounts: {
        action: () => { actions.push("manage"); },
      },
      additional: {
        values: { columnIds: ["ticker", "reason"] },
        fields: [{
          key: "columnIds",
          label: "Columns",
          type: "ordered-multi-select",
          options: [{ value: "ticker", label: "Ticker" }],
        }],
      },
    });

    expect(definition.values).toEqual({
      defaultProviderId: "anthropic",
      defaultModelId: "claude-sonnet-4-5",
      providerId: "",
      modelId: "claude-custom",
      columnIds: ["ticker", "reason"],
    });
    expect(definition.fields.slice(0, 4).map((field) => [
      field.key,
      field.type === "action" ? undefined : field.storage,
    ])).toEqual([
      [AI_DEFAULT_PROVIDER_SETTING_KEY, "plugin"],
      [AI_DEFAULT_MODEL_SETTING_KEY, "plugin"],
      ["providerId", undefined],
      ["modelId", undefined],
    ]);
    expect(definition.fields[0]?.type !== "action" && definition.fields[0]?.clearOnChange)
      .toEqual([AI_DEFAULT_MODEL_SETTING_KEY]);
    expect(definition.fields[2]?.type !== "action" && definition.fields[2]?.clearOnChange)
      .toEqual(["modelId"]);
    expect(definition.fields.at(-1)?.key).toBe("columnIds");

    const accountAction = definition.fields.find((field) => field.key === "account:anthropic");
    const manageAction = definition.fields.find((field) => field.key === "manageAiAccounts");
    if (accountAction?.type !== "action" || manageAction?.type !== "action") {
      throw new Error("Expected AI account actions");
    }
    await accountAction.action({} as PaneSettingActionContext);
    await manageAction.action({} as PaneSettingActionContext);
    expect(actions).toEqual(["anthropic", "manage"]);
  });

  test("keeps persisted models selectable when a provider catalog no longer returns them", () => {
    const definition = buildAiPaneSettingsDef({
      title: "Agent Settings",
      providers,
      models,
      defaultProviderId: "openai-codex",
      defaultModelId: "retired-gpt",
      paneOverride: {
        providerId: "anthropic",
        modelId: "retired-claude",
      },
    });

    const defaultModel = definition.fields.find((field) => field.key === "defaultModelId");
    const paneModel = definition.fields.find((field) => field.key === "modelId");
    if (defaultModel?.type !== "select" || paneModel?.type !== "select") {
      throw new Error("Expected model selectors");
    }

    expect(defaultModel.options.map((option) => option.value)).toEqual(["", "gpt-5.4", "retired-gpt"]);
    expect(paneModel.options.map((option) => option.value)).toEqual(["", "claude-sonnet-4-5", "retired-claude"]);
    expect(definition.fields.some((field) => field.type === "action")).toBe(false);
  });

  test("migrates legacy runner ids while preserving saved identity until an override is configured", () => {
    expect(resolveAiPaneSelection({
      settings: {},
      savedProviderId: "claude",
      savedModelId: "sonnet",
      defaultProviderId: "codex",
      defaultModelId: "gpt-default",
    })).toEqual({ providerId: "anthropic", modelId: "sonnet" });

    expect(resolveAiPaneSelection({
      settings: { providerId: "", modelId: "" },
      savedProviderId: "claude",
      savedModelId: "sonnet",
      defaultProviderId: "codex",
      defaultModelId: "gpt-default",
    })).toEqual({ providerId: "openai-codex", modelId: "gpt-default" });

    expect(resolveAiPaneSelection({
      settings: { providerId: "" },
      savedProviderId: "claude",
      savedModelId: "old-sonnet",
      defaultProviderId: "claude",
      defaultModelId: "new-sonnet",
    })).toEqual({ providerId: "anthropic", modelId: "new-sonnet" });
  });

  test("does not carry a saved model across an explicit provider change", () => {
    expect(resolveAiPaneSelection({
      settings: { providerId: "openai-codex" },
      savedProviderId: "anthropic",
      savedModelId: "claude-sonnet-4-5",
      defaultProviderId: "anthropic",
      defaultModelId: "claude-sonnet-4-5",
    })).toEqual({ providerId: "openai-codex", modelId: null });
  });

  test("normalizes shared defaults from plugin config", () => {
    expect(resolveAiSharedDefaults({
      defaultProviderId: " codex ",
      defaultModelId: " gpt-default ",
    }, "claude")).toEqual({ providerId: "openai-codex", modelId: "gpt-default" });
    expect(resolveAiSharedDefaults(undefined, "claude"))
      .toEqual({ providerId: "anthropic", modelId: null });
  });
});
