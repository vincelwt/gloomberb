import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatUserSummary } from "../../../utils/api-client";
import {
  PROFILE_POPOVER_CLOSE_DELAY_MS,
  hasPublicChatProfileInfo,
} from "./message/profile-popover";

export function useChatProfilePopover() {
  const [profilePopoverUser, setProfilePopoverUser] = useState<ChatUserSummary | null>(null);
  const profilePopoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelProfilePopoverClose = useCallback(() => {
    if (profilePopoverCloseTimerRef.current == null) return;
    clearTimeout(profilePopoverCloseTimerRef.current);
    profilePopoverCloseTimerRef.current = null;
  }, []);

  const closeProfilePopover = useCallback(() => {
    cancelProfilePopoverClose();
    setProfilePopoverUser(null);
  }, [cancelProfilePopoverClose]);

  const scheduleProfilePopoverClose = useCallback(() => {
    cancelProfilePopoverClose();
    profilePopoverCloseTimerRef.current = setTimeout(() => {
      profilePopoverCloseTimerRef.current = null;
      setProfilePopoverUser(null);
    }, PROFILE_POPOVER_CLOSE_DELAY_MS);
  }, [cancelProfilePopoverClose]);

  const showProfilePopover = useCallback((targetUser: ChatUserSummary) => {
    if (!hasPublicChatProfileInfo(targetUser)) {
      closeProfilePopover();
      return;
    }
    cancelProfilePopoverClose();
    setProfilePopoverUser(targetUser);
  }, [cancelProfilePopoverClose, closeProfilePopover]);

  useEffect(() => () => cancelProfilePopoverClose(), [cancelProfilePopoverClose]);

  return {
    cancelProfilePopoverClose,
    closeProfilePopover,
    profilePopoverUser,
    scheduleProfilePopoverClose,
    showProfilePopover,
  };
}
