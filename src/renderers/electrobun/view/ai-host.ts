import {
  AI_RUNNER_CAPABILITY_ID,
  type AiRunnerEvent,
} from "../../../capabilities";
import {
  getAiProviderDefinitions,
  __setDetectedProvidersForTests,
} from "../../../plugins/builtin/ai/providers";
import { AiRunCancelledError, setAiRunHost } from "../../../plugins/builtin/ai/runner";
import { backendRequest, onCapabilityEvent } from "./backend-rpc";

let nextRunId = 1;

export async function installElectrobunAiHost(): Promise<void> {
  const availability = await backendRequest<Record<string, boolean>>("capability.invoke", {
    capabilityId: AI_RUNNER_CAPABILITY_ID,
    operationId: "getProviderAvailability",
    payload: {},
  });
  const providers = getAiProviderDefinitions().map((definition) => ({
    ...definition,
    available: availability[definition.id] ?? false,
  }));

  __setDetectedProvidersForTests(providers);
  setAiRunHost({
    run({ provider, prompt, cwd, onChunk }) {
      const subscriptionId = `ai-run:${nextRunId++}`;
      let disposed = false;
      let settled = false;
      let disposeMessages: () => void = () => {};
      let resolveDone: (output: string) => void = () => {};
      let rejectDone: (error: unknown) => void = () => {};

      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        disposeMessages();
        void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
      };

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const done = new Promise<string>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });

      disposeMessages = onCapabilityEvent(subscriptionId, (message) => {
        const event = message.event as AiRunnerEvent;
        switch (event.kind) {
          case "chunk":
            onChunk?.(event.output);
            break;
          case "done":
            settle(() => resolveDone(event.output));
            break;
          case "cancelled":
            settle(() => rejectDone(new AiRunCancelledError()));
            break;
          case "error":
            settle(() => rejectDone(new Error(event.error)));
            break;
        }
      });

      void backendRequest("capability.subscribe", {
        subscriptionId,
        capabilityId: AI_RUNNER_CAPABILITY_ID,
        operationId: "run",
        payload: {
          providerId: provider.id,
          prompt,
          cwd,
        },
      }).catch((error) => {
        settle(() => rejectDone(error));
      });

      return {
        done,
        cancel() {
          settle(() => rejectDone(new AiRunCancelledError()));
        },
      };
    },
  });
}
