import { apiClient, type ChatNotification } from "../../../../api-client";
import {
  SAFETY_REFRESH_MS,
  VERIFICATION_POLL_MS,
} from "./state";

interface ChatControllerRealtimeOptions {
  getAppActive: () => boolean;
  getSessionToken: () => string | null;
  getUser: () => { emailVerified?: boolean } | null;
  refreshSession: () => Promise<void>;
  handleNotification: (notification: ChatNotification) => void;
  setOnlineCount: (onlineCount: number) => void;
  emit: () => void;
  getSafetyRefreshChannelIds: () => string[];
  runSafetyRefresh: (channelId: string) => Promise<void>;
}

export class ChatControllerRealtime {
  private verificationPollTimer: ReturnType<typeof setInterval> | null = null;
  private safetyRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private chatNotificationUnsubscribe: (() => void) | null = null;
  private chatPresenceUnsubscribe: (() => void) | null = null;

  constructor(private readonly options: ChatControllerRealtimeOptions) {}

  syncVerificationPolling(): void {
    const user = this.options.getUser();
    if (!this.options.getAppActive() || !this.options.getSessionToken() || !user || user.emailVerified) {
      this.stopVerificationPolling();
      return;
    }
    if (this.verificationPollTimer) return;
    this.verificationPollTimer = setInterval(() => {
      void this.options.refreshSession().catch(() => {});
    }, VERIFICATION_POLL_MS);
  }

  ensureRealtimeSubscriptions(): void {
    if (!this.chatNotificationUnsubscribe) {
      this.chatNotificationUnsubscribe = apiClient.subscribeChatNotifications((notification) => {
        this.options.handleNotification(notification);
      });
    }
    if (!this.chatPresenceUnsubscribe) {
      this.chatPresenceUnsubscribe = apiClient.subscribeChatPresence((onlineCount) => {
        this.options.setOnlineCount(onlineCount);
        this.options.emit();
      });
    }
  }

  stopRealtimeSubscriptions(): void {
    this.chatNotificationUnsubscribe?.();
    this.chatNotificationUnsubscribe = null;
    this.chatPresenceUnsubscribe?.();
    this.chatPresenceUnsubscribe = null;
  }

  stopVerificationPolling(): void {
    if (!this.verificationPollTimer) return;
    clearInterval(this.verificationPollTimer);
    this.verificationPollTimer = null;
  }

  startSafetyRefresh(): void {
    if (this.safetyRefreshTimer) return;
    this.safetyRefreshTimer = setInterval(() => {
      if (!this.options.getUser()?.emailVerified || !this.options.getSessionToken()) {
        this.stopSafetyRefresh();
        return;
      }
      for (const channelId of this.options.getSafetyRefreshChannelIds()) {
        void this.options.runSafetyRefresh(channelId).catch(() => {});
      }
    }, SAFETY_REFRESH_MS);
    this.safetyRefreshTimer.unref?.();
  }

  stopSafetyRefresh(): void {
    if (!this.safetyRefreshTimer) return;
    clearInterval(this.safetyRefreshTimer);
    this.safetyRefreshTimer = null;
  }

  stopAll(): void {
    this.stopVerificationPolling();
    this.stopSafetyRefresh();
    this.stopRealtimeSubscriptions();
  }
}
