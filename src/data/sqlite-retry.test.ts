import { describe, expect, test } from "bun:test";
import { isSqliteBusyError, trySqliteBusyOperation, withSqliteBusyRetry } from "./sqlite-retry";

function createBusyError(): Error & { code: string; errno: number } {
  const error = new Error("database is locked") as Error & { code: string; errno: number };
  error.code = "SQLITE_BUSY";
  error.errno = 5;
  return error;
}

describe("sqlite busy retry", () => {
  test("recognizes Bun SQLite busy errors", () => {
    expect(isSqliteBusyError(createBusyError())).toBe(true);
    expect(isSqliteBusyError(new Error("other failure"))).toBe(false);
  });

  test("retries busy errors until the operation succeeds", () => {
    let attempts = 0;

    const result = withSqliteBusyRetry("test retry", () => {
      attempts += 1;
      if (attempts < 3) throw createBusyError();
      return "ok";
    }, {
      attempts: 3,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("stops after the configured busy retry attempts", () => {
    let attempts = 0;

    expect(() => withSqliteBusyRetry("test exhaustion", () => {
      attempts += 1;
      throw createBusyError();
    }, {
      attempts: 2,
      initialDelayMs: 0,
      maxDelayMs: 0,
    })).toThrow("database is locked");

    expect(attempts).toBe(2);
  });

  test("optional operations only swallow exhausted busy errors", () => {
    const result = trySqliteBusyOperation("optional busy", () => {
      throw createBusyError();
    }, {
      attempts: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(result).toBeNull();
    expect(() => trySqliteBusyOperation("optional non-busy", () => {
      throw new Error("not sqlite");
    })).toThrow("not sqlite");
  });
});
