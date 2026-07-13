import type { Dispatch } from "react";
import type { AppAction, AppState } from "../core/state/app/state";
import type { TickerRepository } from "../data/ticker-repository";
import { stableStringify } from "../remote/revision";
import {
  SYNC_SNAPSHOT_SCHEMA_VERSION,
  type RegisteredSyncContributor,
  type RegisteredSyncTransport,
  type SyncContributor,
  type SyncSnapshot,
  type SyncTransport,
} from "./types";

export type CloudSyncPhase = "idle" | "disabled" | "syncing" | "synced" | "error";

export interface CloudSyncStatus {
  phase: CloudSyncPhase;
  transportId: string | null;
  lastSyncAt: string | null;
  lastPullAt: string | null;
  revision: number | null;
  error: string | null;
}

interface SyncRuntime {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  tickerRepository: TickerRepository;
  getContributors: () => RegisteredSyncContributor[];
  getTransport: () => RegisteredSyncTransport | null;
}

const CLIENT_ID_STORAGE_KEY = "gloomberb.sync.clientId";
const PUSH_DEBOUNCE_MS = 2500;
const PULL_MIN_INTERVAL_MS = 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function resolveClientId(): string {
  const storage = globalThis.localStorage;
  const existing = storage?.getItem(CLIENT_ID_STORAGE_KEY);
  if (existing) return existing;
  const id = `client_${crypto.randomUUID()}`;
  storage?.setItem(CLIENT_ID_STORAGE_KEY, id);
  return id;
}

export class CloudSyncController {
  private runtime: SyncRuntime | null = null;
  private contributors = new Map<string, RegisteredSyncContributor>();
  private transports = new Map<string, RegisteredSyncTransport>();
  private listeners = new Set<() => void>();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private syncQueued = false;
  private clientId: string | null = null;
  private lastSignature: string | null = null;
  private lastPulledAtMs = 0;
  private hasPulledForTransport = new Set<string>();
  private status: CloudSyncStatus = {
    phase: "idle",
    transportId: null,
    lastSyncAt: null,
    lastPullAt: null,
    revision: null,
    error: null,
  };

  registerContributor(pluginId: string, contributor: SyncContributor): () => void {
    this.contributors.set(contributor.id, { pluginId, contributor });
    this.emit();
    return () => {
      const current = this.contributors.get(contributor.id);
      if (current?.contributor === contributor) {
        this.contributors.delete(contributor.id);
        this.emit();
      }
    };
  }

  registerTransport(pluginId: string, transport: SyncTransport): () => void {
    this.transports.set(transport.id, { pluginId, transport });
    this.emit();
    return () => {
      const current = this.transports.get(transport.id);
      if (current?.transport === transport) {
        this.transports.delete(transport.id);
        this.emit();
      }
    };
  }

  getRegisteredContributors(): RegisteredSyncContributor[] {
    return [...this.contributors.values()];
  }

  getRegisteredTransports(): RegisteredSyncTransport[] {
    return [...this.transports.values()];
  }

  setRuntime(runtime: SyncRuntime): void {
    this.runtime = runtime;
    this.updateAvailability();
  }

  clearRuntime(): void {
    this.runtime = null;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.syncQueued = false;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): CloudSyncStatus {
    return this.status;
  }

  schedulePush(reason: string): void {
    const runtime = this.runtime;
    if (!runtime) return;
    const transport = runtime.getTransport();
    if (!transport?.transport.isAvailable()) {
      this.setStatus({
        phase: "disabled",
        transportId: transport?.transport.id ?? null,
        error: null,
      });
      return;
    }
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.requestSync({ reason });
    }, PUSH_DEBOUNCE_MS);
  }

  async requestSync(options: { reason?: string; force?: boolean } = {}): Promise<void> {
    if (this.inFlight) {
      this.syncQueued = true;
      return this.inFlight;
    }
    const run = this.syncOnce(options).finally(async () => {
      this.inFlight = null;
      if (!this.syncQueued) return;
      this.syncQueued = false;
      await this.requestSync({ reason: "queued-state-change" });
    });
    this.inFlight = run;
    return run;
  }

  async pullLatest(options: { force?: boolean } = {}): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) return;
    const transport = runtime.getTransport();
    if (!transport?.transport.isAvailable()) {
      this.setStatus({ phase: "disabled", transportId: transport?.transport.id ?? null, error: null });
      return;
    }
    const currentMs = Date.now();
    if (!options.force && currentMs - this.lastPulledAtMs < PULL_MIN_INTERVAL_MS) return;
    if (await this.runPull(runtime, transport.transport)) {
      this.lastPulledAtMs = currentMs;
    }
  }

  private async syncOnce(options: { reason?: string; force?: boolean }): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) return;
    const transportRegistration = runtime.getTransport();
    if (!transportRegistration?.transport.isAvailable()) {
      this.setStatus({ phase: "disabled", transportId: transportRegistration?.transport.id ?? null, error: null });
      return;
    }
    const transport = transportRegistration.transport;
    if (!this.hasPulledForTransport.has(transport.id)) {
      if (!await this.runPull(runtime, transport)) return;
      this.hasPulledForTransport.add(transport.id);
    }

    const snapshot = await this.assembleSnapshot(runtime);
    const signature = stableStringify(snapshot.contributors);
    if (!options.force && signature === this.lastSignature) return;

    this.setStatus({ phase: "syncing", transportId: transport.id, error: null });
    try {
      const result = await transport.pushSnapshot(snapshot, { baseRevision: this.status.revision });
      this.lastSignature = signature;
      this.setStatus({
        phase: "synced",
        transportId: transport.id,
        revision: result.revision,
        lastSyncAt: result.updatedAt,
        error: null,
      });
    } catch (error) {
      this.setStatus({
        phase: "error",
        transportId: transport.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runPull(runtime: SyncRuntime, transport: SyncTransport): Promise<boolean> {
    this.setStatus({ phase: "syncing", transportId: transport.id, error: null });
    try {
      const response = await transport.pullSnapshot();
      this.setStatus({
        phase: response.snapshot ? "synced" : "idle",
        transportId: transport.id,
        revision: response.revision,
        lastPullAt: response.updatedAt ?? nowIso(),
        lastSyncAt: response.updatedAt,
        error: null,
      });
      if (!response.snapshot) return true;
      for (const entry of runtime.getContributors()) {
        const payload = response.snapshot.contributors[entry.contributor.id]?.payload;
        if (payload === undefined || !entry.contributor.apply) continue;
        await entry.contributor.apply(payload, {
          snapshot: response.snapshot,
          state: runtime.state,
          dispatch: runtime.dispatch,
          tickerRepository: runtime.tickerRepository,
        });
      }
      return true;
    } catch (error) {
      this.setStatus({
        phase: "error",
        transportId: transport.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async assembleSnapshot(runtime: SyncRuntime): Promise<SyncSnapshot> {
    const contributors = runtime.getContributors();
    const createdAt = nowIso();
    const payloads: SyncSnapshot["contributors"] = {};
    for (const entry of contributors) {
      const payload = await entry.contributor.collect({ state: runtime.state });
      payloads[entry.contributor.id] = {
        schemaVersion: entry.contributor.schemaVersion,
        updatedAt: createdAt,
        payload,
      };
    }
    return {
      schemaVersion: SYNC_SNAPSHOT_SCHEMA_VERSION,
      appId: "gloomberb",
      clientId: this.clientId ??= resolveClientId(),
      createdAt,
      contributors: payloads,
    };
  }

  private updateAvailability(): void {
    const transport = this.runtime?.getTransport() ?? null;
    if (!transport) {
      this.setStatus({ phase: "disabled", transportId: null, error: null });
      return;
    }
    if (!transport.transport.isAvailable()) {
      this.setStatus({ phase: "disabled", transportId: transport.transport.id, error: null });
      return;
    }
    if (
      this.status.transportId === transport.transport.id &&
      this.status.phase !== "disabled" &&
      this.status.phase !== "idle"
    ) {
      return;
    }
    this.setStatus({
      phase: "idle",
      transportId: transport.transport.id,
      error: null,
    });
  }

  private setStatus(patch: Partial<CloudSyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const cloudSyncController = new CloudSyncController();
