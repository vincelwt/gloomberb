import type { Api, Model, ModelsStore, ModelsStoreEntry } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { LockedJsonFile } from "./file-store";

const MODELS_FILE_VERSION = 1;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

interface ModelsFile {
  version: typeof MODELS_FILE_VERSION;
  providers: Record<string, ModelsStoreEntry>;
}

function assertProviderId(providerId: string): void {
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new Error(`Invalid AI provider id: ${providerId}`);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isCost(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!["input", "output", "cacheRead", "cacheWrite"].every((key) => isFiniteNumber(candidate[key]))) return false;
  return candidate.tiers === undefined
    || (Array.isArray(candidate.tiers) && candidate.tiers.every((tier) => {
      if (!tier || typeof tier !== "object" || Array.isArray(tier)) return false;
      const record = tier as Record<string, unknown>;
      return ["input", "output", "cacheRead", "cacheWrite", "inputTokensAbove"]
        .every((key) => isFiniteNumber(record[key]));
    }));
}

function isModel(value: unknown): value is Model<Api> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return typeof model.id === "string"
    && typeof model.name === "string"
    && typeof model.api === "string"
    && typeof model.provider === "string"
    && typeof model.baseUrl === "string"
    && typeof model.reasoning === "boolean"
    && Array.isArray(model.input)
    && model.input.every((input) => input === "text" || input === "image")
    && isCost(model.cost)
    && isFiniteNumber(model.contextWindow)
    && isFiniteNumber(model.maxTokens)
    && (model.headers === undefined || isStringRecord(model.headers));
}

function validateEntry(value: unknown, providerId?: string): ModelsStoreEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The cached AI model entry is invalid.");
  }
  const candidate = value as { models?: unknown; lastModified?: unknown; checkedAt?: unknown };
  if (!Array.isArray(candidate.models) || !candidate.models.every(isModel)) {
    throw new Error("The cached AI model entry contains invalid models.");
  }
  if (providerId && candidate.models.some((model) => model.provider !== providerId)) {
    throw new Error(`The cached model provider does not match ${providerId}.`);
  }
  if (candidate.lastModified !== undefined && !isFiniteNumber(candidate.lastModified)) {
    throw new Error("The cached AI model last-modified timestamp is invalid.");
  }
  if (candidate.checkedAt !== undefined && !isFiniteNumber(candidate.checkedAt)) {
    throw new Error("The cached AI model check timestamp is invalid.");
  }
  return structuredClone(candidate) as ModelsStoreEntry;
}

function validateModelsFile(value: unknown): ModelsFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The AI model cache is not an object.");
  }
  const candidate = value as { version?: unknown; providers?: unknown };
  if (candidate.version !== MODELS_FILE_VERSION) {
    throw new Error(`Unsupported AI model cache version: ${String(candidate.version)}`);
  }
  if (!candidate.providers || typeof candidate.providers !== "object" || Array.isArray(candidate.providers)) {
    throw new Error("The AI model cache does not contain a providers object.");
  }

  const providers: Record<string, ModelsStoreEntry> = Object.create(null) as Record<string, ModelsStoreEntry>;
  for (const [providerId, entry] of Object.entries(candidate.providers)) {
    assertProviderId(providerId);
    providers[providerId] = validateEntry(entry, providerId);
  }
  return { version: MODELS_FILE_VERSION, providers };
}

function createModelsFile(): ModelsFile {
  return {
    version: MODELS_FILE_VERSION,
    providers: Object.create(null) as Record<string, ModelsStoreEntry>,
  };
}

export function resolvePiModelsPath(dataDir: string): string {
  return join(dataDir, "ai", "models.json");
}

export class PiFileModelsStore implements ModelsStore {
  readonly path: string;
  private readonly file: LockedJsonFile<ModelsFile>;

  constructor(dataDir: string) {
    this.path = resolvePiModelsPath(dataDir);
    this.file = new LockedJsonFile(this.path, {
      create: createModelsFile,
      validate: validateModelsFile,
    });
  }

  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    assertProviderId(providerId);
    const entry = (await this.file.read()).providers[providerId];
    return entry ? structuredClone(entry) : undefined;
  }

  async write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    assertProviderId(providerId);
    const validated = validateEntry(entry, providerId);
    await this.file.update((file) => {
      file.providers[providerId] = structuredClone(validated);
    });
  }

  async delete(providerId: string): Promise<void> {
    assertProviderId(providerId);
    await this.file.update((file) => {
      delete file.providers[providerId];
    });
  }
}
