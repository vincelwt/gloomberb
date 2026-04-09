import { TextAttributes } from "@opentui/core";
import { spawn } from "child_process";
import { colors } from "../../theme/colors";

export function openUrl(url: string) {
  if (!url.trim()) return;

  const child = process.platform === "darwin"
    ? spawn("open", [url], { detached: true, stdio: "ignore" })
    : process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });

  child.unref();
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
  return (
    <text
      fg={color}
      attributes={TextAttributes.UNDERLINE}
      onMouseDown={(event: any) => handleOpen(url, onOpen, event)}
    >
      {label ?? url}
    </text>
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
    <box height={1}>
      <ExternalLinkText url={url} label={label} color={color} onOpen={onOpen} />
    </box>
  );
}
