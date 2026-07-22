export interface LiveStreamResolveRequest {
  provider: "youtube";
  sourceId: string;
  force?: boolean;
}

export interface ResolvedLiveStream {
  provider: "youtube";
  sourceId: string;
  videoId: string;
  title: string;
  manifestUrl: string;
  watchUrl: string;
  posterUrl?: string;
  resolvedAt: number;
  expiresAt: number;
}
