import { expect, test } from "bun:test";
import type { AppState } from "../core/state/app/state";
import type { TickerRepository } from "../data/ticker-repository";
import { CloudSyncController } from "./controller";
import type { SyncTransport } from "./types";

test("does not push local state when the initial pull fails", async () => {
  let pushes = 0;
  const transport: SyncTransport = {
    id: "failing-pull",
    isAvailable: () => true,
    pullSnapshot: () => Promise.reject(new Error("pull failed")),
    pushSnapshot: async () => {
      pushes += 1;
      return { revision: 1, updatedAt: new Date().toISOString() };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    state: {} as AppState,
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  await controller.requestSync({ force: true });

  expect(pushes).toBe(0);
  expect(controller.getStatus()).toMatchObject({ phase: "error", error: "pull failed" });
});
