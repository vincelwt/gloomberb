import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { setPaneSetting } from "../../../pane-settings";
import {
  syncConfigActiveLayoutState,
  useAppDispatch,
  useAppSelector,
  useAppStateRef,
  usePaneInstance,
  usePaneInstanceId,
} from "../../../state/app-context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import type { PaneProps } from "../../../types/plugin";
import {
  DEFAULT_CHAT_CHANNEL_ID,
  LAST_VISITED_CHAT_CHANNEL_KEY,
  normalizeChannelId,
} from "./channels";

interface ChatPaneContentProps {
  width: number;
  height: number;
  focused: boolean;
  channelId?: string;
  onChannelChange?: (channelId: string) => void;
}

export function createChatPane(ChatContent: (props: ChatPaneContentProps) => ReactNode) {
  return function ChatPane({ focused, width, height }: PaneProps) {
    const dispatch = useAppDispatch();
    const stateRef = useAppStateRef();
    const paneId = usePaneInstanceId();
    const pane = usePaneInstance();
    const rawPaneChannelId = typeof pane?.settings?.channelId === "string" ? pane.settings.channelId : null;
    const lastVisitedChannelId = useAppSelector((state) => (
      (state.config.pluginConfig["gloomberb-cloud"]?.[LAST_VISITED_CHAT_CHANNEL_KEY] as string | undefined) ??
      DEFAULT_CHAT_CHANNEL_ID
    ));
    const initialChannelIdRef = useRef(normalizeChannelId(rawPaneChannelId ?? lastVisitedChannelId));
    const persistedChannelId = normalizeChannelId(rawPaneChannelId ?? initialChannelIdRef.current);
    const persistChannelId = useCallback((nextChannelId: string) => {
      const currentState = stateRef.current;
      const layout = setPaneSetting(currentState.config.layout, paneId, "channelId", nextChannelId);
      const pluginConfig = {
        ...currentState.config.pluginConfig,
        "gloomberb-cloud": {
          ...(currentState.config.pluginConfig["gloomberb-cloud"] ?? {}),
          [LAST_VISITED_CHAT_CHANNEL_KEY]: nextChannelId,
        },
      };
      const nextConfig = {
        ...currentState.config,
        layout,
        pluginConfig,
      };
      const syncedConfig = syncConfigActiveLayoutState(
        nextConfig,
        currentState.paneState,
        currentState.focusedPaneId,
        currentState.activePanel,
      );
      dispatch({ type: "SET_CONFIG", config: syncedConfig });
      scheduleConfigSave(syncedConfig);
    }, [dispatch, paneId, stateRef]);
    const [channelId, setLocalChannelId] = useState(initialChannelIdRef.current);
    const pendingChannelIdRef = useRef<string | null>(null);

    useEffect(() => {
      if (rawPaneChannelId) return;
      persistChannelId(initialChannelIdRef.current);
    }, [persistChannelId, rawPaneChannelId]);

    useEffect(() => {
      const normalizedPersisted = normalizeChannelId(persistedChannelId);
      if (pendingChannelIdRef.current) {
        if (pendingChannelIdRef.current === normalizedPersisted) {
          pendingChannelIdRef.current = null;
        }
        return;
      }
      setLocalChannelId((current) => (current === normalizedPersisted ? current : normalizedPersisted));
    }, [persistedChannelId]);

    const setChannelId = useCallback((nextChannelId: string) => {
      const normalized = normalizeChannelId(nextChannelId);
      pendingChannelIdRef.current = normalized;
      setLocalChannelId((current) => (current === normalized ? current : normalized));
      persistChannelId(normalized);
    }, [persistChannelId]);

    return (
      <ChatContent
        width={width}
        height={height}
        focused={focused}
        channelId={channelId}
        onChannelChange={setChannelId}
      />
    );
  };
}
