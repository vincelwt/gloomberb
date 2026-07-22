export const TV_CHANNELS = [
  {
    id: "bloomberg",
    name: "Bloomberg",
    channelId: "UCIALMKvObZNtJ6AmdCLP7Lg",
    channelUrl: "https://www.youtube.com/@markets/live",
  },
  {
    id: "cnbc",
    name: "CNBC",
    channelId: "UCvJJ_dzjViJCoLf5uKUTwoA",
    channelUrl: "https://www.youtube.com/@CNBC/live",
  },
  {
    id: "yahoo-finance",
    name: "Yahoo Finance",
    channelId: "UCEAZeUIeJs0IjQiqTCdVSIg",
    channelUrl: "https://www.youtube.com/@YahooFinance/live",
  },
] as const;

export type TvChannel = (typeof TV_CHANNELS)[number];
export type TvChannelId = TvChannel["id"];

export function getTvChannel(id: TvChannelId): TvChannel {
  return TV_CHANNELS.find((channel) => channel.id === id) ?? TV_CHANNELS[0];
}
