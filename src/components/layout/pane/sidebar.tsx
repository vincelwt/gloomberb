import { createContext, useContext, useState, type ReactNode } from "react";
import { Box, Text, useUiCapabilities } from "../../../ui";
import { blendHex, colors, hoverBg } from "../../../theme/colors";

const PANE_SIDEBAR_MIN_WIDTH = 18;
const PANE_SIDEBAR_MAX_WIDTH = 24;
const DESKTOP_PANE_SIDEBAR_MIN_WIDTH = 14;
const DESKTOP_PANE_SIDEBAR_MAX_WIDTH = 19;
const DESKTOP_PANE_SIDEBAR_WIDTH_RATIO = 0.192;
const PANE_SIDEBAR_BREAKPOINT = 72;
const PANE_SIDEBAR_MOUSE_HANDLED = "__gloomberbPaneSidebarHandled";

export function shouldShowPaneSidebar(
  itemCount: number,
  width: number,
  height: number,
  minimumItemCount = 2,
): boolean {
  return itemCount >= minimumItemCount && width >= PANE_SIDEBAR_BREAKPOINT && height >= 8;
}

export function getPaneSidebarWidth(width: number, nativePaneChrome: boolean): number {
  const minimumWidth = nativePaneChrome ? DESKTOP_PANE_SIDEBAR_MIN_WIDTH : PANE_SIDEBAR_MIN_WIDTH;
  const maximumWidth = nativePaneChrome ? DESKTOP_PANE_SIDEBAR_MAX_WIDTH : PANE_SIDEBAR_MAX_WIDTH;
  const widthRatio = nativePaneChrome ? DESKTOP_PANE_SIDEBAR_WIDTH_RATIO : 0.24;
  return Math.min(maximumWidth, Math.max(minimumWidth, Math.floor(width * widthRatio)));
}

export interface PaneSidebarRenderState {
  backgroundColor: string;
  listWidth: number;
}

interface PaneSidebarContextValue extends PaneSidebarRenderState {
  activeBackgroundColor: string;
  keyboardFocused: boolean;
}

const PaneSidebarContext = createContext<PaneSidebarContextValue | null>(null);

function usePaneSidebarContext(): PaneSidebarContextValue {
  const context = useContext(PaneSidebarContext);
  if (!context) throw new Error("PaneSidebarRow and PaneSidebarAction must be rendered inside PaneSidebar.");
  return context;
}

export function PaneSidebar({
  width,
  height,
  focused,
  keyboardFocused = false,
  children,
}: {
  width: number;
  height: number;
  focused: boolean;
  keyboardFocused?: boolean;
  children: ReactNode | ((state: PaneSidebarRenderState) => ReactNode);
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const borderWidth = nativePaneChrome ? 0 : width > 1 ? 1 : 0;
  const listWidth = Math.max(width - borderWidth, 1);
  const dividerColor = focused ? colors.borderFocused : colors.border;
  const backgroundColor = keyboardFocused
    ? blendHex(colors.panel, colors.borderFocused, 0.18)
    : colors.panel;
  const activeBackgroundColor = keyboardFocused
    ? blendHex(colors.selected, colors.borderFocused, 0.32)
    : blendHex(colors.panel, colors.selected, 0.35);
  const sidebarLayoutHeight = nativePaneChrome ? "100%" : height;
  const nativeFillStyle = nativePaneChrome ? { minHeight: 0 } : undefined;
  const renderState = { backgroundColor, listWidth };

  return (
    <PaneSidebarContext.Provider value={{ ...renderState, activeBackgroundColor, keyboardFocused }}>
      <Box
        width={width}
        height={sidebarLayoutHeight}
        flexDirection="row"
        position="relative"
        style={nativeFillStyle}
        data-gloom-role="pane-sidebar"
      >
        <Box
          width={listWidth}
          height={sidebarLayoutHeight}
          flexDirection="column"
          backgroundColor={backgroundColor}
          style={nativeFillStyle}
        >
          {typeof children === "function" ? children(renderState) : children}
        </Box>
        {borderWidth > 0 && (
          <Box width={1} height={height} flexDirection="column">
            {Array.from({ length: height }, (_, index) => (
              <Text key={index} fg={dividerColor} selectable={false}>│</Text>
            ))}
          </Box>
        )}
        {nativePaneChrome && (
          <Box
            position="absolute"
            top={0}
            right={0}
            width={1}
            height={sidebarLayoutHeight}
            style={{
              width: 1,
              height: "100%",
              backgroundColor: dividerColor,
              pointerEvents: "none",
            }}
          />
        )}
      </Box>
    </PaneSidebarContext.Provider>
  );
}

export interface PaneSidebarRowRenderState {
  foregroundColor: string;
  listWidth: number;
  onMouseDown: (event?: any) => void;
}

export function PaneSidebarRow({
  active,
  disabled = false,
  height = 1,
  ariaLabel,
  onSelect,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  height?: number;
  ariaLabel: string;
  onSelect?: (event?: any) => void;
  children: ReactNode | ((state: PaneSidebarRowRenderState) => ReactNode);
}) {
  const { activeBackgroundColor, backgroundColor, keyboardFocused, listWidth } = usePaneSidebarContext();
  const [hovered, setHovered] = useState(false);
  const foregroundColor = active
    ? colors.selectedText
    : keyboardFocused
      ? colors.text
      : colors.textDim;
  const rowBackgroundColor = active ? activeBackgroundColor : hovered ? hoverBg() : backgroundColor;
  const handleMouseDown = (event?: any) => {
    if (disabled) return;
    if (event) {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (event[PANE_SIDEBAR_MOUSE_HANDLED]) return;
      event[PANE_SIDEBAR_MOUSE_HANDLED] = true;
    }
    onSelect?.(event);
  };
  const renderState = { foregroundColor, listWidth, onMouseDown: handleMouseDown };

  return (
    <Box
      height={height}
      width={listWidth}
      flexDirection="row"
      backgroundColor={rowBackgroundColor}
      aria-label={ariaLabel}
      data-gloom-role="pane-sidebar-item"
      onMouseDown={handleMouseDown}
      onMouseOver={() => {
        if (!disabled) setHovered((current) => current ? current : true);
      }}
      onMouseOut={() => setHovered((current) => current ? false : current)}
      style={{ cursor: disabled ? "default" : "pointer" }}
    >
      {typeof children === "function" ? children(renderState) : children}
    </Box>
  );
}

export interface PaneSidebarActionRenderState {
  foregroundColor: string;
  hovered: boolean;
  onMouseDown: (event?: any) => void;
}

export function PaneSidebarAction({
  width,
  ariaLabel,
  disabled = false,
  highlightOnHover = true,
  onPress,
  children,
}: {
  width: number;
  ariaLabel: string;
  disabled?: boolean;
  highlightOnHover?: boolean;
  onPress?: (event?: any) => void;
  children: ReactNode | ((state: PaneSidebarActionRenderState) => ReactNode);
}) {
  usePaneSidebarContext();
  const [hovered, setHovered] = useState(false);
  const handleMouseDown = (event?: any) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (event) {
      if (event[PANE_SIDEBAR_MOUSE_HANDLED]) return;
      event[PANE_SIDEBAR_MOUSE_HANDLED] = true;
    }
    if (disabled) return;
    onPress?.(event);
  };
  const renderState = {
    foregroundColor: hovered ? colors.textMuted : colors.textDim,
    hovered,
    onMouseDown: handleMouseDown,
  };

  return (
    <Box
      width={width}
      height={1}
      alignItems="center"
      justifyContent="center"
      backgroundColor={hovered && highlightOnHover ? hoverBg() : undefined}
      aria-label={ariaLabel}
      data-gloom-role="pane-sidebar-action"
      onMouseOver={() => {
        if (!disabled) setHovered((current) => current ? current : true);
      }}
      onMouseOut={() => setHovered((current) => current ? false : current)}
      onMouseDown={handleMouseDown}
      style={{ cursor: disabled ? "default" : "pointer" }}
    >
      {typeof children === "function" ? children(renderState) : children}
    </Box>
  );
}
