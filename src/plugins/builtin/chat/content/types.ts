import type { ChatController } from "../controller";

export type ChatContentController = Pick<
  ChatController,
  | "attachView"
  | "attachChannelView"
  | "getSnapshot"
  | "refreshChannels"
  | "refreshChatState"
  | "refreshPresence"
  | "loadOlderMessages"
  | "loadOlderChannelMessages"
  | "refreshMessages"
  | "refreshChannelMessages"
  | "refreshSession"
  | "send"
  | "sendToChannel"
  | "openDirectChannel"
  | "openGroupChannel"
  | "setDraft"
  | "setChannelDraft"
  | "setChannelNotificationsEnabled"
  | "setReplyToId"
  | "setChannelReplyToId"
  | "subscribe"
>;
