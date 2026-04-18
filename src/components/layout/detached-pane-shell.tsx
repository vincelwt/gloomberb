import { Box, Text, useRendererHost, useUiCapabilities } from "../../ui";
import { useCallback, useEffect, useMemo } from "react";
import { useViewport } from "../../react/input";
import { useAppDispatch, useAppSelector } from "../../state/app-context";
import type { DesktopWindowBridge } from "../../types/desktop-window";
import { findPaneInstance } from "../../types/config";
import type { PluginRegistry } from "../../plugins/registry";
import { colors, floatingPaneBg, floatingPaneTitleBg, paneTitleText } from "../../theme/colors";
import { hasPaneFooterContent, PaneFooterBar, PaneFooterProvider } from "./pane-footer";
import { PaneContent } from "./pane-content";
import { getPaneBodyWidth } from "./pane-sizing";
import { getPaneDisplayTitle } from "./pane-title";
import { TITLEBAR_OVERLAY_HEIGHT_PX, TITLEBAR_TRAFFIC_LIGHT_WIDTH } from "./titlebar-overlay";

interface DetachedPaneShellProps {
  pluginRegistry: PluginRegistry;
  desktopWindowBridge: DesktopWindowBridge & { kind: "detached"; paneId: string };
}

function stopMouse(event?: { stopPropagation?: () => void; preventDefault?: () => void }) {
  event?.stopPropagation?.();
  event?.preventDefault?.();
}

export function DetachedPaneShell({ pluginRegistry, desktopWindowBridge }: DetachedPaneShellProps) {
  const dispatch = useAppDispatch();
  const rendererHost = useRendererHost();
  const config = useAppSelector((state) => state.config);
  const paneState = useAppSelector((state) => state.paneState);
  const focusedPaneId = useAppSelector((state) => state.focusedPaneId);
  const { width, height } = useViewport();
  const { cellHeightPx = 18, nativePaneChrome, titleBarOverlay } = useUiCapabilities();
  const instance = useAppSelector((state) => findPaneInstance(state.config.layout, desktopWindowBridge.paneId) ?? null);
  const paneDef = instance ? pluginRegistry.panes.get(instance.paneId) ?? null : null;
  const hasPaneSettings = !!instance && pluginRegistry.hasPaneSettings(instance.instanceId);
  const titleState = useMemo(
    () => ({ config, paneState }) as Parameters<typeof getPaneDisplayTitle>[0],
    [config, paneState],
  );
  const title = instance && paneDef
    ? getPaneDisplayTitle(titleState, instance, paneDef)
    : "Detached Pane";
  const focused = focusedPaneId === desktopWindowBridge.paneId || focusedPaneId == null;
  const bodyWidth = nativePaneChrome ? Math.max(1, Math.floor(width)) : getPaneBodyWidth(width);

  useEffect(() => {
    if (desktopWindowBridge.paneId && focusedPaneId !== desktopWindowBridge.paneId) {
      dispatch({ type: "FOCUS_PANE", paneId: desktopWindowBridge.paneId });
    }
  }, [desktopWindowBridge.paneId, dispatch, focusedPaneId]);

  const focusPane = useCallback(() => {
    dispatch({ type: "FOCUS_PANE", paneId: desktopWindowBridge.paneId });
  }, [desktopWindowBridge.paneId, dispatch]);

  const startWindowDrag = useCallback(() => {
    focusPane();
    void rendererHost.startWindowDrag?.();
  }, [focusPane, rendererHost]);

  const openSettings = useCallback((event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    stopMouse(event);
    pluginRegistry.openPaneSettingsFn(desktopWindowBridge.paneId);
  }, [desktopWindowBridge.paneId, pluginRegistry]);

  if (!instance || !paneDef) {
    return (
      <Box flexGrow={1} alignItems="center" justifyContent="center" backgroundColor={colors.bg}>
        <Text fg={colors.textDim}>Pane unavailable.</Text>
      </Box>
    );
  }

  return (
    <PaneFooterProvider>
      {(footer) => {
        const showFooter = hasPaneFooterContent(footer);
        const headerHeightRows = titleBarOverlay ? TITLEBAR_OVERLAY_HEIGHT_PX / cellHeightPx : 1;
        const footerHeightRows = showFooter ? 1 : 0;
        const bodyHeight = Math.max(1, height - headerHeightRows - footerHeightRows);
        const titleBackground = floatingPaneTitleBg(focused);

        return (
          <Box
            flexDirection="column"
            flexGrow={1}
            width={width}
            height={height}
            backgroundColor={floatingPaneBg(focused)}
            data-gloom-role="detached-pane-window"
            data-focused={focused ? "true" : "false"}
            onMouseDown={focusPane}
          >
            <Box
              height={1}
              width={width}
              backgroundColor={titleBackground}
              flexDirection="row"
              data-gloom-role="pane-header"
              data-titlebar-overlay={titleBarOverlay ? "true" : undefined}
              data-floating="true"
              data-focused={focused ? "true" : "false"}
              style={{ boxShadow: `0 -1px 0 ${titleBackground}, inset 0 1px 0 ${titleBackground}` }}
              onMouseDown={startWindowDrag}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                flexGrow={1}
                minWidth={0}
                paddingLeft={titleBarOverlay ? TITLEBAR_TRAFFIC_LIGHT_WIDTH : 1}
                paddingRight={1}
              >
                <Box flexGrow={1} minWidth={0} overflow="hidden">
                  <Text fg={paneTitleText(focused, true)} selectable={false} data-gloom-role="pane-title">{title}</Text>
                </Box>
                {hasPaneSettings && (
                  <Text
                    fg={paneTitleText(focused, true)}
                    selectable={false}
                    className="electrobun-webkit-app-region-no-drag"
                    data-gloom-role="pane-action"
                    data-gloom-interactive="true"
                    onMouseDown={openSettings}
                  >
                    {" ... "}
                  </Text>
                )}
              </Box>
            </Box>
            <Box height={bodyHeight} overflow="hidden" backgroundColor={colors.bg}>
              <PaneContent
                component={paneDef.component}
                paneId={instance.instanceId}
                paneType={instance.paneId}
                focused={focused}
                width={bodyWidth}
                height={bodyHeight}
              />
            </Box>
            {showFooter && <PaneFooterBar footer={footer} focused={focused} width={width} />}
          </Box>
        );
      }}
    </PaneFooterProvider>
  );
}
