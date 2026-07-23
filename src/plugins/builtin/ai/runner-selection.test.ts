import { describe, expect, test } from "bun:test";
import type { AiProvider, AiProviderId } from "./providers";
import {
  AI_AUTO_MODEL_VALUE,
  buildAiRunnerWizard,
  getAiModelSelectionOptions,
  getAiRunnerWizardModelKey,
  getSelectableAiRunners,
  isAiProviderReady,
  modelIdAfterAiProviderChange,
  normalizeAiModelId,
  resolveAiRunnerWizardModel,
  resolveReadyAiRunnerDefault,
  supportsAiRunOutputMode,
} from "./runner-selection";
import type { AiRuntimeCatalog } from "./runner";

function provider(
  id: AiProviderId,
  status: AiProvider["status"],
  outputModes: AiProvider["outputModes"] = ["plain", "structured", "screener"],
): AiProvider {
  return {
    id,
    name: id.toUpperCase(),
    available: status === "ready",
    status,
    ...(status !== "ready" ? { unavailableReason: `${id} is not connected.` } : {}),
    outputModes,
  };
}

function catalog(providers: AiProvider[]): AiRuntimeCatalog {
  return {
    providers: providers.map((entry) => ({
      providerId: entry.id,
      label: entry.name,
      status: entry.status,
      ...(entry.unavailableReason ? { unavailableReason: entry.unavailableReason } : {}),
      outputModes: [...entry.outputModes],
    })),
    accounts: [],
    models: [],
  };
}

describe("AI runner selection", () => {
  test("shows every capable provider while preselecting one that is ready", () => {
    const providers = [
      provider("anthropic", "not_authenticated"),
      provider("openai-codex", "ready"),
      provider("google", "ready", ["plain"]),
    ];

    expect(getSelectableAiRunners(providers, {
      outputMode: "structured",
      runtimeCatalog: catalog(providers),
    }).map(({ id }) => id)).toEqual(["anthropic", "openai-codex"]);
    expect(buildAiRunnerWizard(providers, {
      outputMode: "structured",
      runtimeCatalog: catalog(providers),
    })[0]?.defaultValue).toBe("openai-codex");
  });

  test("shows the full capable catalog with connection labels when none are ready", () => {
    const providers = [
      provider("anthropic", "not_authenticated"),
      provider("openai-codex", "check_failed"),
      provider("google", "not_authenticated", ["plain"]),
    ];
    const wizard = buildAiRunnerWizard(providers, {
      outputMode: "structured",
      runtimeCatalog: catalog(providers),
    });

    expect(getSelectableAiRunners(providers, {
      outputMode: "structured",
      runtimeCatalog: catalog(providers),
    }).map(({ id }) => id)).toEqual(["anthropic", "openai-codex"]);
    expect(wizard[0]?.type === "select" ? wizard[0].options?.map((option) => option.label) : [])
      .toEqual(["ANTHROPIC (sign in)", "OPENAI-CODEX (unavailable)"]);
    expect(wizard[0]?.defaultValue).toBe("anthropic");
  });

  test("derives capabilities only from Pi catalog output modes", () => {
    const plain = provider("google", "ready", ["plain"]);
    const structured = provider("anthropic", "ready");
    const runtimeCatalog = catalog([plain, structured]);

    expect(supportsAiRunOutputMode(plain, "structured", runtimeCatalog)).toBe(false);
    expect(supportsAiRunOutputMode(structured, "structured", runtimeCatalog)).toBe(true);
  });

  test("preselects configured defaults from a provider-scoped Pi model catalog", () => {
    const providers = [
      provider("anthropic", "ready"),
      provider("openai-codex", "ready"),
    ];
    const wizard = buildAiRunnerWizard(providers, {
      defaultProviderId: "anthropic",
      defaultModelId: " claude-opus-4-8 ",
      outputMode: "structured",
    });

    expect(wizard[0]?.defaultValue).toBe("anthropic");
    expect(wizard[1]).toMatchObject({
      key: getAiRunnerWizardModelKey("anthropic"),
      type: "select",
      required: true,
      defaultValue: "claude-opus-4-8",
      dependsOn: { key: "providerId", value: "anthropic" },
    });
    expect(wizard[1]?.options?.map((option) => option.value))
      .toEqual([AI_AUTO_MODEL_VALUE, "claude-opus-4-8"]);
    expect(resolveAiRunnerWizardModel({
      [getAiRunnerWizardModelKey("anthropic")]: "claude-opus-4-8",
    }, "anthropic")).toBe("claude-opus-4-8");
    expect(resolveAiRunnerWizardModel({
      [getAiRunnerWizardModelKey("anthropic")]: AI_AUTO_MODEL_VALUE,
    }, "anthropic")).toBeNull();
    expect(normalizeAiModelId("  provider/model ")).toBe("provider/model");
    expect(normalizeAiModelId("   ")).toBeNull();
  });

  test("uses Pi labels and availability in model choices", () => {
    const runtimeCatalog = catalog([provider("anthropic", "ready")]);
    runtimeCatalog.providers[0]!.defaultModelId = "claude-sonnet";
    runtimeCatalog.models = [
      {
        id: "claude-sonnet",
        providerId: "anthropic",
        label: "Claude Sonnet",
        available: true,
      },
      {
        id: "claude-opus",
        providerId: "anthropic",
        label: "Claude Opus",
        available: false,
      },
    ];

    expect(getAiModelSelectionOptions("anthropic", null, runtimeCatalog)).toEqual([
      expect.objectContaining({ value: AI_AUTO_MODEL_VALUE, label: "Auto · Claude Sonnet" }),
      expect.objectContaining({ value: "claude-sonnet", label: "Claude Sonnet" }),
      expect.objectContaining({ value: "claude-opus", label: "Claude Opus · connect to use" }),
    ]);
  });

  test("replaces an unready configured provider with a ready one and clears its model", () => {
    const providers = [
      provider("anthropic", "not_authenticated"),
      provider("openai-codex", "ready"),
    ];

    expect(resolveReadyAiRunnerDefault(providers, "claude", "claude-opus-4-8"))
      .toEqual({ providerId: "openai-codex", modelId: null });
  });

  test("uses legacy aliases only when migrating defaults and model selections", () => {
    const providers = [provider("anthropic", "ready")];

    expect(resolveReadyAiRunnerDefault(providers, "claude", "claude-opus-4-8"))
      .toEqual({ providerId: "anthropic", modelId: "claude-opus-4-8" });
    expect(modelIdAfterAiProviderChange("anthropic", "claude", " claude-opus-4-8 "))
      .toBe("claude-opus-4-8");
    expect(modelIdAfterAiProviderChange("openai-codex", "claude", "claude-opus-4-8"))
      .toBe("");
  });

  test("does not present a disconnected provider as ready", () => {
    expect(isAiProviderReady(provider("anthropic", "not_authenticated"))).toBe(false);
  });
});
