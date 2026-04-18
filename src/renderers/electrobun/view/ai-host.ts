import {
  getAiProviderDefinitions,
  __setDetectedProvidersForTests,
} from "../../../plugins/builtin/ai/providers";
import { setAiRunHost } from "../../../plugins/builtin/ai/runner";
import { backendRequest, onAiChunk } from "./backend-rpc";

let nextRunId = 1;

export async function installElectrobunAiHost(): Promise<void> {
  const availability = await backendRequest<Record<string, boolean>>("ai.getProviderAvailability");
  const providers = getAiProviderDefinitions().map((definition) => ({
    ...definition,
    available: availability[definition.id] ?? false,
  }));

  __setDetectedProvidersForTests(providers);
  setAiRunHost({
    run({ provider, prompt, cwd, onChunk }) {
      const runId = `ai-run:${nextRunId++}`;
      const disposeChunks = onAiChunk(runId, ({ output }) => {
        onChunk?.(output);
      });
      let disposed = false;

      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        disposeChunks();
      };

      const done = backendRequest<string>("ai.run", {
        runId,
        providerId: provider.id,
        prompt,
        cwd,
      }).finally(cleanup);

      return {
        done,
        cancel() {
          cleanup();
          void backendRequest("ai.cancel", { runId }).catch(() => {});
        },
      };
    },
  });
}
