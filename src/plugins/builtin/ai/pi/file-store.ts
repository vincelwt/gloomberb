import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export interface LockedJsonFileOptions<T> {
  create: () => T;
  validate: (value: unknown) => T;
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : null;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Small backend-only JSON store with atomic replacement and a cross-process
 * lock. The lock is important because the TUI and desktop backend may share
 * one Gloomberb data directory and Pi refreshes rotating OAuth tokens inside
 * CredentialStore.modify().
 */
export class LockedJsonFile<T> {
  readonly path: string;

  private readonly options: Required<Pick<LockedJsonFileOptions<T>, "lockTimeoutMs" | "staleLockMs">>
    & Omit<LockedJsonFileOptions<T>, "lockTimeoutMs" | "staleLockMs">;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string, options: LockedJsonFileOptions<T>) {
    this.path = path;
    this.options = {
      ...options,
      lockTimeoutMs: options.lockTimeoutMs ?? 45_000,
      staleLockMs: options.staleLockMs ?? 10 * 60_000,
    };
  }

  async read(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return this.options.create();
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Could not parse ${this.path}`, { cause: error });
    }
    return this.options.validate(parsed);
  }

  update<R>(mutate: (current: T) => R | Promise<R>): Promise<R> {
    const queued = this.writeQueue.catch(() => {}).then(async () => {
      const release = await this.acquireLock();
      try {
        const current = await this.read();
        const result = await mutate(current);
        await this.write(current);
        return result;
      } finally {
        await release();
      }
    });
    this.writeQueue = queued.then(() => {}, () => {});
    return queued;
  }

  private async write(value: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: DIRECTORY_MODE });
    await chmod(dirname(this.path), DIRECTORY_MODE).catch(() => {});

    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", FILE_MODE);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporaryPath, this.path);
      await chmod(this.path, FILE_MODE).catch(() => {});
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    const lockPath = `${this.path}.lock`;
    const token = `${process.pid}:${randomUUID()}`;
    const deadline = Date.now() + this.options.lockTimeoutMs;
    await mkdir(dirname(this.path), { recursive: true, mode: DIRECTORY_MODE });
    await chmod(dirname(this.path), DIRECTORY_MODE).catch(() => {});

    while (true) {
      try {
        const handle = await open(lockPath, "wx", FILE_MODE);
        try {
          await handle.writeFile(token, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        return async () => {
          const owner = await readFile(lockPath, "utf8").catch(() => null);
          if (owner === token) await rm(lockPath, { force: true }).catch(() => {});
        };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }

      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs >= this.options.staleLockMs) {
        await rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the AI store lock at ${lockPath}`);
      }
      await wait(25);
    }
  }
}
