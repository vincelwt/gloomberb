import { Box } from "../../ui";
import type {
  DockDividerLayout,
  DockLeafLayout,
  FloatingRect,
  LayoutBounds,
  ResolvedPane,
} from "../../plugins/pane-manager";
import { colors } from "../../theme/colors";
import { constrainFloatingRectToBounds } from "./shell-drag";
import { pathKey } from "./window-edit-mode";
import { FloatingPaneWrapper } from "./floating-pane";
import { PaneContent } from "./pane-content";
import { PaneWrapper } from "./pane";
import { hasPaneFooterContent, PaneFooterProvider } from "./pane-footer";
import { resolvePaneBodyFrame, shouldReservePaneFooter } from "./pane-sizing";
import type { DividerPreviewState } from "./shell-native-window-state";

type ShellMouseHandler = (event: any) => void;

interface VisibleFloatingPane {
  pane: ResolvedPane;
  rect: FloatingRect;
}

interface ShellPaneLayersProps {
  contentHeight: number;
  dividerPreview: DividerPreviewState | null;
  dockDividerLayouts: DockDividerLayout[];
  dockLeafLayouts: DockLeafLayout[];
  dragFloatingRect: { paneId: string; rect: FloatingRect } | null;
  focusedPaneId: string | null;
  getPaneTitle: (pane: ResolvedPane) => string;
  handleFloatingClose: (paneId: string) => void;
  handleFloatingCloseMouseDown: (paneId: string, event: any) => void;
  handleNativeDrag: ShellMouseHandler;
  handleNativePaneContextMenu: (paneId: string, rect: LayoutBounds, event: any) => void;
  handleNativePaneMouseDown: (paneId: string, event: any) => void;
  handlePaneAction: (paneId: string, rect: LayoutBounds, event: any) => void;
  hoveredPaneId: string | null;
  menuPaneId: string | null;
  nativeContextMenu?: boolean;
  nativePaneChrome: boolean;
  overlayOpen: boolean;
  paneMap: Map<string, ResolvedPane>;
  setHoveredPaneIfChanged: (paneId: string | null) => void;
  startNativeDividerDrag: (divider: DockDividerLayout, event: any) => void;
  startNativeDockedDrag: (paneId: string, rect: LayoutBounds, event: any) => void;
  startNativeFloatingDrag: (paneId: string, rect: FloatingRect, event: any) => void;
  startNativeFloatResize: (paneId: string, rect: FloatingRect, event: any) => void;
  visibleFloatingPanes: VisibleFloatingPane[];
  width: number;
  windowModeDockResizePathKey: string | null;
  windowModePaneId: string | null;
}

export function ShellPaneLayers({
  contentHeight,
  dividerPreview,
  dockDividerLayouts,
  dockLeafLayouts,
  dragFloatingRect,
  focusedPaneId,
  getPaneTitle,
  handleFloatingClose,
  handleFloatingCloseMouseDown,
  handleNativeDrag,
  handleNativePaneContextMenu,
  handleNativePaneMouseDown,
  handlePaneAction,
  hoveredPaneId,
  menuPaneId,
  nativeContextMenu,
  nativePaneChrome,
  overlayOpen,
  paneMap,
  setHoveredPaneIfChanged,
  startNativeDividerDrag,
  startNativeDockedDrag,
  startNativeFloatingDrag,
  startNativeFloatResize,
  visibleFloatingPanes,
  width,
  windowModeDockResizePathKey,
  windowModePaneId,
}: ShellPaneLayersProps) {
  return (
    <>
      {dockLeafLayouts.map((leaf) => {
        const pane = paneMap.get(leaf.instanceId);
        if (!pane) return null;
        const focused = focusedPaneId === leaf.instanceId && (!overlayOpen || menuPaneId === leaf.instanceId);
        const windowModeSelected = windowModePaneId === leaf.instanceId;
        const showActions = focused || hoveredPaneId === leaf.instanceId || menuPaneId === leaf.instanceId;
        return (
          <Box
            key={`dock:${leaf.instanceId}`}
            position="absolute"
            left={leaf.rect.x}
            top={leaf.rect.y}
            width={leaf.rect.width}
            height={leaf.rect.height}
          >
            <PaneFooterProvider>
              {(footer) => {
                const reserveFooter = shouldReservePaneFooter(nativePaneChrome, hasPaneFooterContent(footer));
                const bodyFrame = resolvePaneBodyFrame({
                  width: leaf.rect.width,
                  height: leaf.rect.height,
                  nativePaneChrome,
                  reserveFooter,
                });
                return (
                  <PaneWrapper
                    paneId={leaf.instanceId}
                    title={getPaneTitle(pane)}
                    focused={focused}
                    width={leaf.rect.width}
                    height={leaf.rect.height}
                    showActions={showActions}
                    windowModeSelected={windowModeSelected}
                    footer={footer}
                    onMouseDown={nativePaneChrome ? (event) => handleNativePaneMouseDown(leaf.instanceId, event) : undefined}
                    onMouseMove={() => setHoveredPaneIfChanged(leaf.instanceId)}
                    onHeaderMouseDown={nativePaneChrome ? (event) => startNativeDockedDrag(leaf.instanceId, leaf.rect, event) : undefined}
                    onHeaderMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
                    onHeaderMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
                    onHeaderContextMenu={nativePaneChrome && nativeContextMenu === true ? (event) => handleNativePaneContextMenu(leaf.instanceId, leaf.rect, event) : undefined}
                    onActionMouseDown={(event) => handlePaneAction(leaf.instanceId, leaf.rect, event)}
                  >
                    <PaneContent
                      component={pane.def.component}
                      paneId={pane.instance.instanceId}
                      paneType={pane.instance.paneId}
                      focused={focused}
                      width={bodyFrame.width ?? 1}
                      height={bodyFrame.height ?? 1}
                    />
                  </PaneWrapper>
                );
              }}
            </PaneFooterProvider>
          </Box>
        );
      })}

      {visibleFloatingPanes.map(({ pane, rect }) => {
        const preview = dragFloatingRect?.paneId === pane.instance.instanceId
          ? constrainFloatingRectToBounds(dragFloatingRect.rect, width, contentHeight)
          : rect;
        const focused = focusedPaneId === pane.instance.instanceId && (!overlayOpen || menuPaneId === pane.instance.instanceId);
        const windowModeSelected = windowModePaneId === pane.instance.instanceId;
        const showActions = focused || hoveredPaneId === pane.instance.instanceId || menuPaneId === pane.instance.instanceId;
        return (
          <PaneFooterProvider key={`float:${pane.instance.instanceId}`}>
            {(footer) => {
              const reserveFooter = shouldReservePaneFooter(nativePaneChrome, hasPaneFooterContent(footer));
              const bodyFrame = resolvePaneBodyFrame({
                width: preview.width,
                height: preview.height,
                nativePaneChrome,
                reserveFooter,
              });
              return (
                <FloatingPaneWrapper
                  paneId={pane.instance.instanceId}
                  title={getPaneTitle(pane)}
                  x={preview.x}
                  y={preview.y}
                  width={preview.width}
                  height={preview.height}
                  zIndex={pane.floating?.zIndex ?? 50}
                  focused={focused}
                  windowModeSelected={windowModeSelected}
                  showActions={showActions}
                  footer={footer}
                  onMouseDown={nativePaneChrome ? (event) => handleNativePaneMouseDown(pane.instance.instanceId, event) : undefined}
                  onMouseMove={() => setHoveredPaneIfChanged(pane.instance.instanceId)}
                  onHeaderMouseDown={nativePaneChrome ? (event) => startNativeFloatingDrag(pane.instance.instanceId, preview, event) : undefined}
                  onHeaderMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
                  onHeaderMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
                  onHeaderContextMenu={nativePaneChrome && nativeContextMenu === true ? (event) => handleNativePaneContextMenu(pane.instance.instanceId, preview, event) : undefined}
                  onActionMouseDown={(event) => handlePaneAction(pane.instance.instanceId, preview, event)}
                  onCloseMouseDown={(event) => handleFloatingCloseMouseDown(pane.instance.instanceId, event)}
                  onResizeMouseDown={nativePaneChrome ? (event) => startNativeFloatResize(pane.instance.instanceId, preview, event) : undefined}
                  onResizeMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
                  onResizeMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
                >
                  <PaneContent
                    component={pane.def.component}
                    paneId={pane.instance.instanceId}
                    paneType={pane.instance.paneId}
                    focused={focused}
                    width={bodyFrame.width ?? 1}
                    height={bodyFrame.height ?? 1}
                    onClose={handleFloatingClose}
                  />
                </FloatingPaneWrapper>
              );
            }}
          </PaneFooterProvider>
        );
      })}

      {dockDividerLayouts.map((divider) => {
        const dividerPathKey = pathKey(divider.path);
        const previewActive = dividerPreview?.pathKey === dividerPathKey;
        const active = previewActive || windowModeDockResizePathKey === dividerPathKey;
        const rect = previewActive ? dividerPreview.rect : divider.rect;
        return (
          <Box
            key={`divider:${divider.path.join(".")}`}
            position="absolute"
            left={rect.x}
            top={rect.y}
            width={rect.width}
            height={rect.height}
            zIndex={active ? 2 : 1}
            backgroundColor={active ? colors.borderFocused : colors.border}
            {...(nativePaneChrome ? {
              "data-gloom-role": "dock-divider",
              "data-axis": divider.axis,
              "data-active": active ? "true" : "false",
              style: { "--divider-color": active ? colors.borderFocused : colors.border } as any,
            } : {})}
            onMouseDown={nativePaneChrome ? (event: any) => startNativeDividerDrag(divider, event) : undefined}
            onMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
            onMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
          />
        );
      })}
    </>
  );
}
