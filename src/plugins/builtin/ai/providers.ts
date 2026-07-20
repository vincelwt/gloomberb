import { resolveAiCliCommand } from "./command-resolution";

export interface AiProvider {
  id: string;
  name: string;
  command: string;
  available: boolean;
  buildArgs: (prompt: string) => string[];
  buildStructuredArgs?: (prompt: string) => string[];
  authCheckArgs?: string[];
  authLoginCommand?: string;
}

export interface AiProviderDefinition extends Omit<AiProvider, "available"> {}

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
    authCheckArgs: ["auth", "status"],
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
    authCheckArgs: ["login", "status"],
    authLoginCommand: "codex login",
  },
  {
    id: "pi",
    name: "Pi",
    command: "pi",
    buildArgs: (prompt) => ["-p", "--mode", "text", "--offline", "--no-tools", "--no-session", "-nc", "-ne", "-ns", prompt],
    buildStructuredArgs: (prompt) => ["-p", "--mode", "json", "--offline", "--no-tools", "--no-session", "-nc", "-ne", "-ns", prompt],
    // No authCheckArgs: pi authenticates via config/env (no auth-status subcommand);
    // an inconclusive/unauthenticated state surfaces at run time.
  },
];

let detectedProviders: AiProvider[] | null = null;

function commandExists(command: string): boolean {
  try {
    return resolveAiCliCommand(command) !== null;
  } catch {
    return false;
  }
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

export function __setDetectedProvidersForTests(providers: AiProvider[] | null): void {
  detectedProviders = providers;
}

export function getAiProviderDefinitions(): AiProviderDefinition[] {
  return PROVIDER_DEFS.map((definition) => ({ ...definition }));
}
