export interface AiProvider {
  id: string;
  name: string;
  command: string;
  available: boolean;
  status?: AiProviderStatus;
  unavailableReason?: string;
  buildArgs: (prompt: string) => string[];
  buildStructuredArgs?: (prompt: string) => string[];
  authLoginCommand?: string;
}

export type AiProviderStatus = "ready" | "missing" | "not_authenticated" | "check_failed";

export interface AiProviderAvailability {
  available: boolean;
  status: AiProviderStatus;
  unavailableReason?: string;
}

export interface AiProviderDefinition extends Omit<AiProvider, "available" | "status" | "unavailableReason"> {}

const PROVIDER_DEFS: AiProviderDefinition[] = [
  {
    id: "claude",
    name: "Claude",
    command: "claude",
    buildArgs: (prompt) => ["-p", prompt],
    buildStructuredArgs: (prompt) => [
      "--print",
      prompt,
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--no-session-persistence",
      "--safe-mode",
      "--tools",
      "",
      "--permission-mode",
      "manual",
    ],
    authLoginCommand: "claude auth login",
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
    buildArgs: (prompt) => ["exec", "--skip-git-repo-check", prompt],
    buildStructuredArgs: (prompt) => [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "shell_tool",
      "--sandbox",
      "read-only",
      "--json",
      prompt,
    ],
    authLoginCommand: "codex login",
  },
  {
    id: "pi",
    name: "Pi",
    command: "pi",
    buildArgs: (prompt) => ["-p", "--mode", "text", "--offline", "--no-tools", "--no-session", "-nc", "-ne", "-ns", prompt],
    buildStructuredArgs: (prompt) => ["-p", "--mode", "json", "--offline", "--no-tools", "--no-session", "-nc", "-ne", "-ns", prompt],
    // Pi authenticates via config/env (no auth-status subcommand), so readiness
    // is based on executable discovery and authentication errors surface at run time.
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
    ...availabilityFromCommand(definition, commandExists(definition.command)),
  }));
  return detectedProviders;
}

function availabilityFromCommand(
  provider: AiProviderDefinition,
  available: boolean,
): AiProviderAvailability {
  return available
    ? { available: true, status: "ready" }
    : {
        available: false,
        status: "missing",
        unavailableReason: `${provider.name} is not installed or was not found in PATH.`,
      };
}

export function getAvailableProviders(providers = detectProviders()): AiProvider[] {
  return providers.filter((provider) => provider.available);
}

export function getLocalWorkspaceProviders(providers = detectProviders()): AiProvider[] {
  return providers.filter((provider) => provider.id === "claude" || provider.id === "codex" || provider.id === "pi");
}

export function getAiProvider(providerId: string | null | undefined, providers = detectProviders()): AiProvider | null {
  if (!providerId) return null;
  return providers.find((provider) => provider.id === providerId) ?? null;
}

export function resolveDefaultAiProviderId(providers = detectProviders()): string {
  return getAvailableProviders(providers)[0]?.id ?? providers[0]?.id ?? "claude";
}

export function getAiProviderUnavailableReason(provider: AiProvider): string {
  return provider.unavailableReason
    ?? `${provider.name} is not installed, not authenticated, or not available in PATH.`;
}

export function getAiProviderUnavailableLabel(provider: AiProvider): string {
  if (provider.status === "not_authenticated") return "sign in";
  if (provider.status === "check_failed") return "unavailable";
  return "missing";
}

export function __setDetectedProvidersForTests(providers: AiProvider[] | null): void {
  detectedProviders = providers;
}

export function getAiProviderDefinitions(): AiProviderDefinition[] {
  return PROVIDER_DEFS.map((definition) => ({ ...definition }));
}
