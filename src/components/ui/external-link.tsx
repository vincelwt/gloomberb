import { Box, Text } from "../../ui";
import { TextAttributes } from "../../ui";
import { colors } from "../../theme/colors";
import { useRendererHost } from "../../ui";

export function openUrl(url: string) {
  if (!url.trim()) return;

  const browserWindow = (globalThis as { window?: { open?: (url: string, target?: string, features?: string) => void } }).window;
  if (typeof browserWindow?.open === "function") {
    browserWindow.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  if (typeof Bun !== "undefined" && typeof Bun.spawn === "function") {
    const platform = typeof process !== "undefined" ? process.platform : "linux";
    const command = platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
    const child = Bun.spawn(command, { stdio: ["ignore", "ignore", "ignore"] });
    child.unref();
  }
}

function handleOpen(
  url: string,
  onOpen: (url: string) => void,
  event?: { preventDefault?: () => void; stopPropagation?: () => void },
) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  onOpen(url);
}

export function ExternalLinkText(
  { url, label, color = colors.textBright, onOpen = openUrl }: {
    url: string;
    label?: string;
    color?: string;
    onOpen?: (url: string) => void;
  },
) {
  const rendererHost = useRendererHost();
  const resolvedOpen = onOpen === openUrl
    ? (nextUrl: string) => {
      void rendererHost.openExternal(nextUrl);
    }
    : onOpen;
  return (
    <Text
      fg={color}
      attributes={TextAttributes.UNDERLINE}
      onMouseDown={(event: any) => handleOpen(url, resolvedOpen, event)}
    >
      {label ?? url}
    </Text>
  );
}

export function ExternalLink(
  { url, label, color, onOpen }: {
    url: string;
    label?: string;
    color?: string;
    onOpen?: (url: string) => void;
  },
) {
  return (
    <Box height={1}>
      <ExternalLinkText url={url} label={label} color={color} onOpen={onOpen} />
    </Box>
  );
}
