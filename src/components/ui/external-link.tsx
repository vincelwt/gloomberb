import { TextAttributes } from "@opentui/core";
import { exec } from "child_process";
import { colors } from "../../theme/colors";

export function openUrl(url: string) {
  const cmd = process.platform === "darwin"
    ? `open "${url}"`
    : process.platform === "win32"
      ? `start "" "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, { stdio: "ignore" } as any);
}

export function ExternalLink({ url, label }: { url: string; label?: string }) {
  return (
    <box height={1} onMouseDown={() => openUrl(url)}>
      <text fg={colors.textBright} attributes={TextAttributes.UNDERLINE}>
        {label ?? url}
      </text>
    </box>
  );
}
