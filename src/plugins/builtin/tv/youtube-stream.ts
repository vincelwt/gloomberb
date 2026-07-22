import type { TvChannel } from "./channels";
import type { ResolvedLiveStream } from "../../../types/media";

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_LIVE_CANDIDATES = 6;

export interface ResolvedTvStream extends ResolvedLiveStream {
  sourceId: TvChannel["id"];
}

type YoutubeModule = typeof import("youtubei.js");
type YoutubeClient = InstanceType<YoutubeModule["Innertube"]>;

let clientPromise: Promise<YoutubeClient> | null = null;
const streamCache = new Map<TvChannel["id"], ResolvedTvStream>();
const activeResolutions = new Map<TvChannel["id"], Promise<ResolvedTvStream>>();

async function getYoutubeClient(): Promise<{ client: YoutubeClient; module: YoutubeModule }> {
  const module = await import("youtubei.js");
  module.Log.setLevel(module.Log.Level.ERROR);
  clientPromise ??= module.Innertube.create({
    generate_session_locally: true,
    enable_session_cache: true,
  });
  return { client: await clientPromise, module };
}

function usableCachedStream(sourceId: TvChannel["id"]): ResolvedTvStream | null {
  const cached = streamCache.get(sourceId);
  if (!cached) return null;
  const validUntil = Math.min(cached.resolvedAt + CACHE_TTL_MS, cached.expiresAt - 60_000);
  return Date.now() < validUntil ? cached : null;
}

async function resolveUncached(channel: TvChannel): Promise<ResolvedTvStream> {
  const { client, module } = await getYoutubeClient();
  const channelFeed = await client.getChannel(channel.channelId);
  if (!channelFeed.has_live_streams) {
    throw new Error(`${channel.name} does not currently expose a live stream.`);
  }

  const liveFeed = await channelFeed.getLiveStreams();
  const candidates = liveFeed.memo
    .getType(module.YTNodes.LockupView)
    .filter((item) => item.content_type === "VIDEO")
    .slice(0, MAX_LIVE_CANDIDATES);

  for (const candidate of candidates) {
    const info = await client.getBasicInfo(candidate.content_id, { client: "ANDROID" });
    const manifestUrl = info.streaming_data?.hls_manifest_url;
    if (!info.basic_info.is_live || !manifestUrl) continue;

    const thumbnails = info.basic_info.thumbnail ?? [];
    const poster = thumbnails.reduce<(typeof thumbnails)[number] | undefined>((best, item) => {
      if (!best) return item;
      return (item.width ?? 0) * (item.height ?? 0) > (best.width ?? 0) * (best.height ?? 0) ? item : best;
    }, undefined);
    const resolvedAt = Date.now();
    const expiresAt = info.streaming_data?.expires?.getTime() ?? resolvedAt + CACHE_TTL_MS;

    return {
      provider: "youtube",
      sourceId: channel.id,
      videoId: candidate.content_id,
      title: info.basic_info.title || candidate.metadata?.title?.toString() || `${channel.name} Live`,
      manifestUrl,
      watchUrl: `https://www.youtube.com/watch?v=${candidate.content_id}`,
      posterUrl: poster?.url,
      resolvedAt,
      expiresAt,
    };
  }

  throw new Error(`${channel.name} does not currently have a playable public live stream.`);
}

export function resolveTvStream(
  channel: TvChannel,
  options?: { force?: boolean },
): Promise<ResolvedTvStream> {
  if (!options?.force) {
    const cached = usableCachedStream(channel.id);
    if (cached) return Promise.resolve(cached);
    const active = activeResolutions.get(channel.id);
    if (active) return active;
  }

  const resolution = resolveUncached(channel)
    .then((stream) => {
      streamCache.set(channel.id, stream);
      return stream;
    })
    .finally(() => {
      if (activeResolutions.get(channel.id) === resolution) {
        activeResolutions.delete(channel.id);
      }
    });
  activeResolutions.set(channel.id, resolution);
  return resolution;
}
