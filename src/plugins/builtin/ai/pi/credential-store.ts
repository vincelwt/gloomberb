import type {
  ApiKeyCredential,
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from "@earendil-works/pi-ai";
import { join } from "node:path";
import { LockedJsonFile } from "./file-store";

const CREDENTIAL_FILE_VERSION = 1;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

interface CredentialFile {
  version: typeof CREDENTIAL_FILE_VERSION;
  credentials: Record<string, Credential>;
}

function assertProviderId(providerId: string): void {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new Error(`Invalid AI provider id: ${providerId}`);
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isApiKeyCredential(value: unknown): value is ApiKeyCredential {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "api_key") return false;
  const credential = value as { key?: unknown; env?: unknown };
  return (credential.key === undefined || typeof credential.key === "string")
    && (credential.env === undefined || isStringRecord(credential.env));
}

function isOAuthCredential(value: unknown): value is OAuthCredential {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "oauth") return false;
  const credential = value as { access?: unknown; refresh?: unknown; expires?: unknown };
  return typeof credential.access === "string"
    && typeof credential.refresh === "string"
    && typeof credential.expires === "number"
    && Number.isFinite(credential.expires);
}

function isCredential(value: unknown): value is Credential {
  return isApiKeyCredential(value) || isOAuthCredential(value);
}

function cloneCredential<T extends Credential | undefined>(credential: T): T {
  return credential === undefined ? credential : structuredClone(credential);
}

function validateCredentialFile(value: unknown): CredentialFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The AI credential file is not an object.");
  }
  const candidate = value as { version?: unknown; credentials?: unknown };
  if (candidate.version !== CREDENTIAL_FILE_VERSION) {
    throw new Error(`Unsupported AI credential file version: ${String(candidate.version)}`);
  }
  if (!candidate.credentials || typeof candidate.credentials !== "object" || Array.isArray(candidate.credentials)) {
    throw new Error("The AI credential file does not contain a credentials object.");
  }

  const credentials: Record<string, Credential> = Object.create(null) as Record<string, Credential>;
  for (const [providerId, credential] of Object.entries(candidate.credentials)) {
    assertProviderId(providerId);
    if (!isCredential(credential)) {
      throw new Error(`The stored AI credential for ${providerId} is invalid.`);
    }
    credentials[providerId] = cloneCredential(credential);
  }
  return { version: CREDENTIAL_FILE_VERSION, credentials };
}

function createCredentialFile(): CredentialFile {
  return {
    version: CREDENTIAL_FILE_VERSION,
    credentials: Object.create(null) as Record<string, Credential>,
  };
}

export function resolvePiCredentialPath(dataDir: string): string {
  return join(dataDir, "ai", "credentials.json");
}

/** Persistent backend credential store for Pi. Secrets never enter AppConfig. */
export class PiFileCredentialStore implements CredentialStore {
  readonly path: string;
  private readonly file: LockedJsonFile<CredentialFile>;

  constructor(dataDir: string) {
    this.path = resolvePiCredentialPath(dataDir);
    this.file = new LockedJsonFile(this.path, {
      create: createCredentialFile,
      validate: validateCredentialFile,
    });
  }

  async read(providerId: string): Promise<Credential | undefined> {
    assertProviderId(providerId);
    const file = await this.file.read();
    return cloneCredential(file.credentials[providerId]);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const file = await this.file.read();
    return Object.entries(file.credentials)
      .map(([providerId, credential]) => ({ providerId, type: credential.type }))
      .sort((left, right) => left.providerId.localeCompare(right.providerId));
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    assertProviderId(providerId);
    return this.file.update(async (file) => {
      const current = cloneCredential(file.credentials[providerId]);
      const next = await update(current);
      if (next !== undefined) {
        if (!isCredential(next)) throw new Error(`Refusing to store an invalid AI credential for ${providerId}.`);
        file.credentials[providerId] = cloneCredential(next);
      }
      return cloneCredential(file.credentials[providerId]);
    });
  }

  async delete(providerId: string): Promise<void> {
    assertProviderId(providerId);
    await this.file.update((file) => {
      delete file.credentials[providerId];
    });
  }
}
