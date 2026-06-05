import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { Button, TextField } from "../../../components";
import { colors } from "../../../theme/colors";
import {
  completeSubstackMagicLink,
  completeSubstackOtpLogin,
  requestSubstackMagicLink,
} from "./api/auth";
import type {
  SubstackAuthState,
} from "./api/types";
import { errorMessage } from "./pane-state";

export function SubstackLoginView({
  width,
  height,
  focused,
  onLogin,
}: {
  width: number;
  height: number;
  focused: boolean;
  onLogin: (auth: SubstackAuthState) => void;
}) {
  const [email, setEmail] = useState("");
  const [loginToken, setLoginToken] = useState("");
  const [phase, setPhase] = useState<"email" | "link">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<InputRenderable | null>(null);
  const linkRef = useRef<InputRenderable | null>(null);
  const panelWidth = Math.max(32, Math.min(72, width - 4));

  useEffect(() => {
    if (!focused) return;
    const input = phase === "email" ? emailRef.current : linkRef.current;
    input?.focus?.();
  }, [focused, phase]);

  const requestLink = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError(null);
    requestSubstackMagicLink(email)
      .then(() => {
        setPhase("link");
      })
      .catch((requestError) => setError(errorMessage(requestError)))
      .finally(() => setBusy(false));
  }, [busy, email]);

  const completeLogin = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const token = loginToken.trim();
    const login = /^\d{6}$/.test(token)
      ? completeSubstackOtpLogin(token, email)
      : completeSubstackMagicLink(token, email);
    login
      .then(onLogin)
      .catch((loginError) => setError(errorMessage(loginError)))
      .finally(() => setBusy(false));
  }, [busy, email, loginToken, onLogin]);

  return (
    <Box width={width} height={height} justifyContent="center" alignItems="center">
      <Box width={panelWidth} flexDirection="column" gap={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Substack login</Text>
        {phase === "email" ? (
          <>
            <TextField
              label="Email"
              value={email}
              placeholder="you@example.com"
              width={panelWidth}
              inputRef={emailRef}
              focused={focused}
              onChange={setEmail}
              onSubmit={requestLink}
            />
            <Button
              label={busy ? "Sending..." : "Send magic link"}
              variant="primary"
              disabled={busy || !email.trim()}
              onPress={requestLink}
            />
          </>
        ) : (
          <>
            <Text fg={colors.textDim}>Paste the 6-digit code or full URL from Substack's email.</Text>
            <TextField
              label="Code or magic link"
              value={loginToken}
              placeholder="123456 or https://substack.com/..."
              width={panelWidth}
              inputRef={linkRef}
              focused={focused}
              onChange={setLoginToken}
              onSubmit={completeLogin}
            />
            <Box flexDirection="row" gap={1}>
              <Button
                label={busy ? "Logging in..." : "Log in"}
                variant="primary"
                disabled={busy || !loginToken.trim()}
                onPress={completeLogin}
              />
              <Button
                label="Change email"
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setPhase("email");
                  setLoginToken("");
                }}
              />
            </Box>
          </>
        )}
        {error ? <Text fg={colors.negative}>{error}</Text> : null}
      </Box>
    </Box>
  );
}
