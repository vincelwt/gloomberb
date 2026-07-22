import type { LiveStreamResolveRequest, ResolvedLiveStream } from "../../../../types/media";
import { getTvChannel, TV_CHANNELS } from "../../../../plugins/builtin/tv/channels";
import { resolveTvStream } from "../../../../plugins/builtin/tv/youtube-stream";

export async function resolveDesktopLiveStream(payload: Record<string, unknown>): Promise<ResolvedLiveStream> {
  const request = payload as Partial<LiveStreamResolveRequest>;
  if (request.provider !== "youtube") {
    throw new Error("Unsupported live-stream provider.");
  }
  const channel = TV_CHANNELS.find((item) => item.id === request.sourceId);
  if (!channel) {
    throw new Error("Unknown TV channel.");
  }
  return resolveTvStream(getTvChannel(channel.id), { force: request.force === true });
}
