export interface AiProvider {
  id: string;
  name: string;
  command: string;
  available: boolean;
  buildArgs: (prompt: string) => string[];
}

export interface AiProviderDefinition extends Omit<AiProvider, "available"> {}

const PROVIDER_DEFS: AiProviderDefinition[] = [
  {
    id: "claude",
    name: "Claude",
    command: "claude",
    buildArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "gemini",
    name: "Gemini",
    command: "gemini",
    buildArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    buildArgs: (prompt) => ["exec", prompt],
  },
];

let detectedProviders: AiProvider[] | null = null;

function commandExists(command: string): boolean {
  try {
    if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
      return !!Bun.which(command);
    }
  } catch {
    return false;
  }
  return false;
}

export function detectProviders(): AiProvider[] {
  if (detectedProviders) return detectedProviders;

  detectedProviders = PROVIDER_DEFS.map((definition) => ({
    ...definition,
    available: commandExists(definition.command),
  }));
  return detectedProviders;
}

export function getAvailableProviders(providers = detectProviders()): AiProvider[] {
  return providers.filter((provider) => provider.available);
}

export function getAiProvider(providerId: string | null | undefined, providers = detectProviders()): AiProvider | null {
  if (!providerId) return null;
  return providers.find((provider) => provider.id === providerId) ?? null;
}

export function resolveDefaultAiProviderId(providers = detectProviders()): string {
  return getAvailableProviders(providers)[0]?.id ?? providers[0]?.id ?? "claude";
}

export function listAiProviderOptions(
  preferredId?: string | null,
  providers = detectProviders(),
): Array<{ label: string; value: string }> {
  const ordered = [...providers].sort((left, right) => {
    if (left.id === preferredId) return -1;
    if (right.id === preferredId) return 1;
    if (left.available !== right.available) return left.available ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return ordered.map((provider) => ({
    value: provider.id,
    label: provider.available ? provider.name : `${provider.name} (missing)`,
  }));
}

export function __setDetectedProvidersForTests(providers: AiProvider[] | null): void {
  detectedProviders = providers;
}

export function getAiProviderDefinitions(): AiProviderDefinition[] {
  return PROVIDER_DEFS.map((definition) => ({ ...definition }));
}
