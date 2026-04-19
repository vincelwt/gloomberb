import { Box, Span, Text, TextAttributes, contextMenuDivider, useContextMenu, useUiCapabilities } from "../../ui";
import { useCallback, useEffect, useState } from "react";
import { colors, hoverBg } from "../../theme/colors";
import { useAppDispatch, useAppSelector, useFocusedTicker } from "../../state/app-context";
import {
  selectActiveLayoutIndex,
  selectGridlockTipSequence,
  selectGridlockTipVisible,
  selectSavedLayouts,
  selectStatusBarVisible,
} from "../../state/selectors-ui";
import {
  getExtendedHoursInfo,
} from "../../utils/market-status";
import { getSharedRegistry } from "../../plugins/registry";
import { gridlockAllPanes } from "../../plugins/pane-manager";
import { notifyGridlockComplete } from "../../plugins/gridlock-notification";
import { PluginSlot } from "../../react/plugins/plugin-slot";
import type { ContextMenuItem } from "../../types/context-menu";
import { Tabs } from "../ui/tabs";

const GRIDLOCK_TIP_DURATION_MS = 60_000;

type StatusBarEvent = { stopPropagation?: () => void; preventDefault?: () => void };
type HoveredControl = string | null;
type SetHoveredControl = (updater: (current: HoveredControl) => HoveredControl) => void;

type LayoutTabItem = {
  label: string;
  value: string;
  onContextMenu: (value: string, event: any) => void;
};

type StatusBarViewProps = {
  activeLayoutIdx: number;
  dismissGridlockTip: (event?: StatusBarEvent) => void;
  extColor: string;
  extText: string;
  handleGridlockTip: (event?: StatusBarEvent) => void;
  handleLayoutSelect: (value: string) => void;
  hasMultipleLayouts: boolean;
  hoveredControl: HoveredControl;
  layoutTabItems: LayoutTabItem[];
  layoutTabsWidth: number;
  openCommandBar: (event?: StatusBarEvent) => void;
  openLayoutContextMenu: (index: number, event: any) => void | Promise<unknown>;
  setHoveredControl: SetHoveredControl;
  showGridlockTip: boolean;
  symbol: string | null | undefined;
};

function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 2) return ".".repeat(width);
  return `${text.slice(0, width - 2)}..`;
}

export function StatusBar() {
  const { nativePaneChrome, nativeContextMenu } = useUiCapabilities();
  const { showContextMenu } = useContextMenu();
  const registry = getSharedRegistry();
  const dispatch = useAppDispatch();
  const layouts = useAppSelector(selectSavedLayouts);
  const activeLayoutIdx = useAppSelector(selectActiveLayoutIndex);
  const statusBarVisible = useAppSelector(selectStatusBarVisible);
  const gridlockTipVisible = useAppSelector(selectGridlockTipVisible);
  const gridlockTipSequence = useAppSelector(selectGridlockTipSequence);
  const { symbol, financials: focusedFinancials } = useFocusedTicker();
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);

  // Extended hours info for selected ticker
  const extInfo = getExtendedHoursInfo(focusedFinancials?.quote);
  const extText = extInfo?.text ?? "";
  const extColor = extInfo?.color ?? colors.textDim;

  const hasMultipleLayouts = layouts.length > 1;
  const showGridlockTip = gridlockTipVisible && !!registry;
  const layoutTabs = layouts.map((layout, index) => ({
    label: `^${index + 1} ${truncate(layout.name, 14)}`,
    value: String(index),
  }));
  const layoutTabsWidth = layoutTabs.reduce((sum, tab) => sum + tab.label.length + 2, 0);
  const handleLayoutSelect = (value: string) => {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= layouts.length) return;
    dispatch({ type: "SWITCH_LAYOUT", index });
  };

  useEffect(() => {
    if (!gridlockTipVisible) return;
    const timer = setTimeout(() => {
      dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
    }, GRIDLOCK_TIP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [dispatch, gridlockTipSequence, gridlockTipVisible]);

  const handleGridlockTip = (event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!registry) return;
    const { width, height } = registry.getTermSizeFn();
    registry.updateLayoutFn(gridlockAllPanes(registry.getLayoutFn(), { x: 0, y: 0, width, height }));
    notifyGridlockComplete(registry.notify.bind(registry), () => {
      dispatch({ type: "UNDO_LAYOUT" });
    });
    dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
  };

  const dismissGridlockTip = (event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
  };

  const openCommandBar = (event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    dispatch({ type: "SET_COMMAND_BAR", open: true, query: "" });
  };

  const layoutContextMenuItems = useCallback((index: number): ContextMenuItem[] => {
    const layout = layouts[index];
    if (!layout) return [];
    const active = index === activeLayoutIdx;
    const switchToLayout = () => {
      if (!active) {
        dispatch({ type: "SWITCH_LAYOUT", index });
      }
    };
    const openWorkflowForLayout = (commandId: string) => {
      switchToLayout();
      registry?.openPluginCommandWorkflow(commandId);
    };
    const items: ContextMenuItem[] = [];

    if (!active) {
      items.push({
        id: "layout:switch",
        label: `Switch to ${layout.name}`,
        onSelect: () => dispatch({ type: "SWITCH_LAYOUT", index }),
      });
      items.push(contextMenuDivider("layout:switch-divider"));
    }

    items.push(
      {
        id: "layout:rename",
        label: "Rename Layout...",
        onSelect: () => openWorkflowForLayout("rename-layout"),
      },
      {
        id: "layout:duplicate",
        label: "Duplicate Layout",
        onSelect: () => dispatch({ type: "DUPLICATE_LAYOUT", index }),
      },
      {
        id: "layout:new",
        label: "New Layout...",
        onSelect: () => registry?.openPluginCommandWorkflow("new-layout"),
      },
      {
        id: "layout:delete",
        label: "Delete Layout...",
        enabled: layouts.length > 1,
        onSelect: () => openWorkflowForLayout("delete-layout"),
      },
      contextMenuDivider("layout:actions-divider"),
      {
        id: "layout:actions",
        label: "Layout Actions...",
        onSelect: () => registry?.openCommandBarFn("LAY "),
      },
    );

    return items;
  }, [activeLayoutIdx, dispatch, layouts, registry]);

  const openLayoutContextMenu = useCallback((
    index: number,
    event: { preventDefault?: () => void; stopPropagation?: () => void },
  ) => {
    const layout = layouts[index];
    if (!layout) return Promise.resolve(false);
    return showContextMenu(
      {
        kind: "layout",
        layoutIndex: index,
        layoutName: layout.name,
        active: index === activeLayoutIdx,
      },
      layoutContextMenuItems(index),
      event,
    );
  }, [activeLayoutIdx, layoutContextMenuItems, layouts, showContextMenu]);
  const handleLayoutTabContextMenu = useCallback((value: string, event: any) => {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= layouts.length) return;
    if (event?.type !== "contextmenu" && event?.button === 2 && nativeContextMenu === true) return;
    void openLayoutContextMenu(index, event);
  }, [layouts.length, nativeContextMenu, openLayoutContextMenu]);
  const layoutTabItems = layoutTabs.map((tab) => ({
    ...tab,
    onContextMenu: handleLayoutTabContextMenu,
  }));

  if (!statusBarVisible) return null;

  const viewProps: StatusBarViewProps = {
    activeLayoutIdx,
    dismissGridlockTip,
    extColor,
    extText,
    handleGridlockTip,
    handleLayoutSelect,
    hasMultipleLayouts,
    hoveredControl,
    layoutTabItems,
    layoutTabsWidth,
    openCommandBar,
    openLayoutContextMenu,
    setHoveredControl,
    showGridlockTip,
    symbol,
  };

  if (nativePaneChrome) {
    return <NativeStatusBar {...viewProps} />;
  }

  return <TerminalStatusBar {...viewProps} />;
}

function NativeStatusBar({
  activeLayoutIdx,
  openLayoutContextMenu,
  showGridlockTip,
  ...props
}: StatusBarViewProps) {
  return (
    <Box
      flexDirection="row"
      height={1}
      alignItems="center"
      backgroundColor={colors.panel}
      data-gloom-role="status-bar"
      onContextMenu={(event: any) => {
        void openLayoutContextMenu(activeLayoutIdx, event);
      }}
      style={{
        borderTop: `1px solid ${colors.border}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
        paddingInline: 8,
      }}
    >
      <StatusBarLayoutControl activeLayoutIdx={activeLayoutIdx} nativePaneChrome {...props} />
      {showGridlockTip && <NativeGridlockTip {...props} />}
      <StatusBarWidgets {...props} />
    </Box>
  );
}

function TerminalStatusBar({
  activeLayoutIdx,
  openLayoutContextMenu,
  showGridlockTip,
  ...props
}: StatusBarViewProps) {
  return (
    <Box
      flexDirection="row"
      height={1}
      alignItems="center"
      backgroundColor={colors.panel}
      data-gloom-role="status-bar"
      onContextMenu={(event: any) => {
        void openLayoutContextMenu(activeLayoutIdx, event);
      }}
    >
      <StatusBarLayoutControl activeLayoutIdx={activeLayoutIdx} nativePaneChrome={false} {...props} />
      {showGridlockTip && <TerminalGridlockTip {...props} />}
      <StatusBarWidgets {...props} />
    </Box>
  );
}

function StatusBarLayoutControl({
  activeLayoutIdx,
  handleLayoutSelect,
  hasMultipleLayouts,
  hoveredControl,
  layoutTabItems,
  layoutTabsWidth,
  nativePaneChrome,
  openCommandBar,
  setHoveredControl,
}: Pick<
  StatusBarViewProps,
  | "activeLayoutIdx"
  | "handleLayoutSelect"
  | "hasMultipleLayouts"
  | "hoveredControl"
  | "layoutTabItems"
  | "layoutTabsWidth"
  | "openCommandBar"
  | "setHoveredControl"
> & { nativePaneChrome: boolean }) {
  return (
    <Box
      paddingLeft={1}
      flexShrink={0}
      flexDirection="row"
      {...(nativePaneChrome ? { alignItems: "center", gap: 1 } : {})}
    >
      {hasMultipleLayouts ? (
        <Box width={layoutTabsWidth} height={1}>
          <Tabs
            tabs={layoutTabItems}
            activeValue={String(activeLayoutIdx)}
            onSelect={handleLayoutSelect}
            compact
            variant="pill"
          />
        </Box>
      ) : (
        <CommandBarHint
          hoveredControl={hoveredControl}
          nativePaneChrome={nativePaneChrome}
          openCommandBar={openCommandBar}
          setHoveredControl={setHoveredControl}
        />
      )}
    </Box>
  );
}

function CommandBarHint({
  hoveredControl,
  nativePaneChrome,
  openCommandBar,
  setHoveredControl,
}: Pick<StatusBarViewProps, "hoveredControl" | "openCommandBar" | "setHoveredControl"> & {
  nativePaneChrome: boolean;
}) {
  const hovered = hoveredControl === "command-bar";
  return (
    <Text
      fg={hovered ? colors.text : colors.textDim}
      {...(!nativePaneChrome ? { bg: hovered ? hoverBg() : undefined } : {})}
      onMouseMove={() => setHoveredControl((current) => (current === "command-bar" ? current : "command-bar"))}
      onMouseDown={openCommandBar}
      {...(nativePaneChrome ? { "data-gloom-interactive": "true" } : {})}
    >
      <Span fg={colors.text}>Ctrl+P</Span> command bar
    </Text>
  );
}

function NativeGridlockTip({
  dismissGridlockTip,
  handleGridlockTip,
  hoveredControl,
  setHoveredControl,
}: Pick<StatusBarViewProps, "dismissGridlockTip" | "handleGridlockTip" | "hoveredControl" | "setHoveredControl">) {
  return (
    <Box paddingLeft={2} flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
      <Text fg={colors.textDim}>Snapped a window?</Text>
      <Text
        fg={hoveredControl === "gridlock-tip" ? colors.textBright : colors.borderFocused}
        attributes={TextAttributes.BOLD}
        onMouseMove={() => setHoveredControl((current) => (current === "gridlock-tip" ? current : "gridlock-tip"))}
        onMouseDown={handleGridlockTip}
        data-gloom-interactive="true"
      >
        Gridlock All
      </Text>
      <Text
        fg={hoveredControl === "gridlock-tip-dismiss" ? colors.text : colors.textDim}
        onMouseMove={() => setHoveredControl((current) => (current === "gridlock-tip-dismiss" ? current : "gridlock-tip-dismiss"))}
        onMouseDown={dismissGridlockTip}
        data-gloom-interactive="true"
      >
        Dismiss
      </Text>
    </Box>
  );
}

function TerminalGridlockTip({
  dismissGridlockTip,
  handleGridlockTip,
  hoveredControl,
  setHoveredControl,
}: Pick<StatusBarViewProps, "dismissGridlockTip" | "handleGridlockTip" | "hoveredControl" | "setHoveredControl">) {
  return (
    <Box paddingLeft={1} flexShrink={0} flexDirection="row">
      <Text fg={colors.textDim}>Snapped a window?</Text>
      <Box width={1} />
      <Box
        backgroundColor={hoveredControl === "gridlock-tip" ? hoverBg() : colors.header}
        onMouseMove={() => setHoveredControl((current) => (current === "gridlock-tip" ? current : "gridlock-tip"))}
        onMouseDown={handleGridlockTip}
      >
        <Text fg={colors.headerText}> Gridlock All </Text>
      </Box>
      <Text
        fg={hoveredControl === "gridlock-tip-dismiss" ? colors.text : colors.textDim}
        onMouseMove={() => setHoveredControl((current) => (current === "gridlock-tip-dismiss" ? current : "gridlock-tip-dismiss"))}
        onMouseDown={dismissGridlockTip}
      >
        {" x"}
      </Text>
    </Box>
  );
}

function StatusBarWidgets({ extColor, extText, symbol }: Pick<StatusBarViewProps, "extColor" | "extText" | "symbol">) {
  return (
    <>
      <Box flexGrow={1} />
      {extText && (
        <Box paddingRight={1}>
          <Text fg={extColor}>{symbol} {extText}</Text>
        </Box>
      )}
      <PluginSlot name="status:widget" />
    </>
  );
}
