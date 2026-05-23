import { useMemo } from "react";
import { AsciiText, Box, Span, Strong, Text, TextAttributes, useUiHost } from "../../ui";
import { colors } from "../../theme/colors";
import { themes } from "../../theme/themes";
import type { PluginRegistry } from "../../plugins/registry";
import { detectShortcutPlatform, formatPrimaryShortcut, getShortcutDisplayMode } from "../../utils/shortcut-labels";
export { PortfolioStep, type PortfolioSub } from "./portfolio-step";

export interface BrokerSyncSummary {
  portfolioId: string | null;
  positionsImported: number;
}

const LOGO_TEXT = "Gloomberb";

export function WelcomeStep() {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={1} />
      <AsciiText text={LOGO_TEXT} font="wordmark" color={colors.textBright} />
      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.textDim}>{"The open terminal for modern finance."}</Text>
      </Box>
      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.textMuted}>{"Let's set things up (~30s)."}</Text>
      </Box>
      <Box height={2} />
    </Box>
  );
}

export function ThemeStep({ themeIds, selectedIdx, height }: { themeIds: string[]; selectedIdx: number; height: number }) {
  const maxVisible = Math.min(themeIds.length, Math.max(6, height - 12));
  const halfWindow = Math.floor(maxVisible / 2);
  let windowStart = Math.max(0, Math.min(selectedIdx - halfWindow, themeIds.length - maxVisible));
  if (windowStart < 0) windowStart = 0;
  const windowEnd = Math.min(themeIds.length, windowStart + maxVisible);

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Theme"}</Text>
      </Box>
      <Box height={1} />
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>{"Change it later from the command bar with "}</Text>
        <Text fg={colors.text} attributes={TextAttributes.BOLD}>{"TH"}</Text>
      </Box>
      <Box height={1} />
      <Box height={1}>
        <Text fg={colors.positive}>{" \u2588\u2588 "}</Text>
        <Text fg={colors.negative}>{" \u2588\u2588 "}</Text>
        <Text fg={colors.text}>{" \u2588\u2588 "}</Text>
        <Text fg={colors.textBright}>{" \u2588\u2588 "}</Text>
        <Text fg={colors.borderFocused}>{" \u2588\u2588 "}</Text>
        <Text fg={colors.textDim}>{" \u2588\u2588 "}</Text>
      </Box>
      <Box height={1} />

      {windowStart > 0 && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{"\u2191 more"}</Text>
        </Box>
      )}

      {themeIds.slice(windowStart, windowEnd).map((id, index) => {
        const theme = themes[id]!;
        const globalIdx = windowStart + index;
        const isSelected = globalIdx === selectedIdx;
        return (
          <Box key={id} height={1} backgroundColor={isSelected ? colors.selected : colors.bg}>
            <Text fg={isSelected ? colors.selectedText : colors.textDim}>
              {isSelected ? "\u25b8 " : "  "}
            </Text>
            <Text fg={isSelected ? colors.text : colors.textDim} attributes={isSelected ? TextAttributes.BOLD : 0}>
              {theme.name}
            </Text>
          </Box>
        );
      })}

      {windowEnd < themeIds.length && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{"\u2193 more"}</Text>
        </Box>
      )}

      <Box height={1} />
      <Box height={1}>
        <Text fg={colors.textMuted}>{"Use \u2191\u2193 to browse"}</Text>
      </Box>
    </Box>
  );
}

export function ShortcutsStep({ pluginRegistry }: { pluginRegistry: PluginRegistry }) {
  const uiHost = useUiHost();
  const shortcutPlatform = detectShortcutPlatform();
  const shortcutDisplayMode = getShortcutDisplayMode(uiHost.kind);
  const platformShortcut = (keys: string | readonly string[]) => formatPrimaryShortcut(keys, shortcutPlatform, shortcutDisplayMode);
  const keyboardShortcuts = [
    { key: "Ctrl+P / `", desc: "Open the command bar" },
    { key: "Tab", desc: "Switch between panels" },
    { key: platformShortcut("W"), desc: "Close the focused pane" },
    { key: platformShortcut(["Shift", "D"]), desc: "Dock or float the focused pane" },
    { key: "q", desc: "Quit" },
  ];

  const commandPrefixes = useMemo(() => {
    const builtIn = [
      { key: "DES AAPL", desc: "Open security details" },
      { key: "TH", desc: "Switch theme" },
      { key: "PL", desc: "Toggle plugins" },
      { key: "PS", desc: "Edit the current window settings" },
      { key: "HELP", desc: "Open the help window" },
    ];

    const builtInKeys = new Set(builtIn.map((entry) => entry.key.split(" ")[0]));
    const pluginPrefixes: { key: string; desc: string }[] = [];

    for (const [, template] of pluginRegistry.paneTemplates) {
      if (!template.shortcut) continue;
      if (builtInKeys.has(template.shortcut.prefix)) continue;
      const label = template.shortcut.argPlaceholder
        ? `${template.shortcut.prefix} <${template.shortcut.argPlaceholder}>`
        : template.shortcut.prefix;
      pluginPrefixes.push({ key: label, desc: template.label });
    }

    pluginPrefixes.sort((a, b) => a.key.localeCompare(b.key));
    return [...builtIn, ...pluginPrefixes];
  }, [pluginRegistry]);

  const COL = 20;

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"After launch shortcuts"}</Text>
      </Box>
      <Box height={1} />

      {keyboardShortcuts.map((shortcut) => (
        <Box key={shortcut.key} height={1} flexDirection="row">
          <Text fg={colors.text} attributes={TextAttributes.BOLD}>{shortcut.key.padEnd(COL)}</Text>
          <Text fg={colors.textDim}>{shortcut.desc}</Text>
        </Box>
      ))}

      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Command-bar prefixes"}</Text>
      </Box>
      <Box height={1} />
      <Box height={1}>
        <Text fg={colors.textDim}>{"Type these in the command bar ("}<Span fg={colors.text}><Strong>{"Ctrl+P"}</Strong></Span>{" or "}<Span fg={colors.text}><Strong>{"`"}</Strong></Span>{"):"}</Text>
      </Box>
      <Box height={1} />

      {commandPrefixes.map((shortcut) => (
        <Box key={shortcut.key} height={1} flexDirection="row">
          <Text fg={colors.text} attributes={TextAttributes.BOLD}>{shortcut.key.padEnd(COL)}</Text>
          <Text fg={colors.textDim}>{shortcut.desc}</Text>
        </Box>
      ))}

      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.textDim}>{"Everything is searchable, just type what you want."}</Text>
      </Box>
    </Box>
  );
}

export function ReadyStep({
  brokerName,
  portfolioName,
  brokerSyncSummary,
  isFinishing,
  error,
}: {
  brokerName: string | null;
  portfolioName: string;
  brokerSyncSummary: BrokerSyncSummary | null;
  isFinishing: boolean;
  error: string | null;
}) {
  const positionsImported = brokerSyncSummary?.positionsImported ?? 0;
  const positionLabel = positionsImported === 1 ? "position" : "positions";

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"You're all set"}</Text>
      </Box>
      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</Text>
        <Text fg={colors.text}>{" Theme configured"}</Text>
      </Box>
      <Box height={1}>
        <Text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</Text>
        <Text fg={colors.text}>
          {brokerName
            ? ` ${brokerName} connected. Imported ${positionsImported} ${positionLabel}`
            : ` Portfolio "${portfolioName}" created`}
        </Text>
      </Box>
      <Box height={1}>
        <Text fg={colors.positive} attributes={TextAttributes.BOLD}>{"\u2713"}</Text>
        <Text fg={colors.text}>{" Plugins enabled"}</Text>
      </Box>
      <Box height={2} />
      {brokerName ? (
        <Box height={1}>
          <Text fg={isFinishing ? colors.text : colors.textDim}>
            {isFinishing
              ? "Launching Gloomberb..."
              : positionsImported > 0
                ? "Your broker portfolio is ready and will open directly after launch."
                : "Broker sync finished. If you expected holdings, check the selected account or connection mode."}
          </Text>
        </Box>
      ) : (
        <Box height={1}>
          <Text fg={colors.textDim}>{"Search for broker names in the command bar to connect."}</Text>
        </Box>
      )}
      {error && (
        <>
          <Box height={1} />
          <Box height={2}>
            <Text fg={colors.negative}>{error}</Text>
          </Box>
        </>
      )}
      <Box height={2} />
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>{"Data stored in "}</Text>
        <Text fg={colors.text}>{"~/gloomberb/"}</Text>
      </Box>
      <Box height={1} />
    </Box>
  );
}
