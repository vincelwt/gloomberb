import { useState } from "react";
import { Box, Text } from "../../ui";
import { Button } from "../../components";
import { usePluginAppActions } from "../plugin-runtime";
import { colors, hoverBg } from "../../theme/colors";

function openAuthCommand(
  openCommandBar: (query?: string) => void,
  query: string,
  event?: { preventDefault?: () => void; stopPropagation?: () => void },
) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  openCommandBar(query);
}

export function InlineAuthActions({ showSignup = true }: { showSignup?: boolean }) {
  const { openCommandBar } = usePluginAppActions();
  const [hoveredAction, setHoveredAction] = useState<"login" | "signup" | null>(null);

  return (
    <Box flexDirection="row">
      <Box
        backgroundColor={hoveredAction === "login" ? hoverBg() : undefined}
        onMouseMove={() => setHoveredAction((current) => (current === "login" ? current : "login"))}
        onMouseOut={() => setHoveredAction((current) => (current === "login" ? null : current))}
        onMouseDown={(event: any) => openAuthCommand(openCommandBar, "Log In", event)}
      >
        <Text fg={hoveredAction === "login" ? colors.text : colors.textDim}> Log In </Text>
      </Box>
      {showSignup && (
        <>
          <Text fg={colors.textDim}>/</Text>
          <Box
            backgroundColor={hoveredAction === "signup" ? hoverBg() : undefined}
            onMouseMove={() => setHoveredAction((current) => (current === "signup" ? current : "signup"))}
            onMouseOut={() => setHoveredAction((current) => (current === "signup" ? null : current))}
            onMouseDown={(event: any) => openAuthCommand(openCommandBar, "Sign Up", event)}
          >
            <Text fg={hoveredAction === "signup" ? colors.text : colors.textDim}> Sign Up </Text>
          </Box>
        </>
      )}
    </Box>
  );
}

export function CloudAuthNotice({
  message,
  showSignup = true,
}: {
  message: string;
  showSignup?: boolean;
}) {
  const { openCommandBar } = usePluginAppActions();

  if (/verification/i.test(message)) {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text fg={colors.positive}>Verify your email to use Cloud tweets.</Text>
        <Button label="Resend Verification Email" variant="secondary" onPress={() => openCommandBar("Resend Verification Email")} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text fg={colors.textDim}>{message}</Text>
      <InlineAuthActions showSignup={showSignup} />
    </Box>
  );
}
