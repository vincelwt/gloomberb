export type ChatComposerCommand =
  | { kind: "direct"; username: string; draft: string }
  | { kind: "group"; usernames: string[]; name: string | undefined };

const USERNAME_PATTERN = "[A-Za-z][A-Za-z0-9_]{2,29}";
const DIRECT_COMMAND_RE = new RegExp(`^/dm\\s+@?(${USERNAME_PATTERN})(?:\\s+([\\s\\S]+))?$`, "i");
const GROUP_COMMAND_RE = /^\/group\s+(.+)$/i;
const GROUP_USERNAME_RE = new RegExp(`@(${USERNAME_PATTERN})`, "g");

export function parseChatComposerCommand(content: string): ChatComposerCommand | null {
  const directCommand = content.match(DIRECT_COMMAND_RE);
  if (directCommand) {
    return {
      kind: "direct",
      username: directCommand[1]!.toLowerCase(),
      draft: directCommand[2]?.trim() ?? "",
    };
  }

  const groupCommand = content.match(GROUP_COMMAND_RE);
  if (!groupCommand) return null;

  const body = groupCommand[1] ?? "";
  const usernames = [...body.matchAll(GROUP_USERNAME_RE)]
    .map((entry) => entry[1]?.toLowerCase())
    .filter((entry): entry is string => !!entry);
  if (usernames.length === 0) return null;

  return {
    kind: "group",
    usernames,
    name: body.replace(GROUP_USERNAME_RE, "").trim() || undefined,
  };
}
