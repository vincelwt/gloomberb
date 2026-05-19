import { Box, ScrollBox, Text, Textarea, TextAttributes, type TextareaRenderable } from "../../ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, ChoiceDialog, TextField, usePaneFooter, type ChoiceDialogChoice, type PaneHint } from "../../components";
import { useShortcut } from "../../react/input";
import { useAppSelector } from "../../state/app-context";
import { colors, hoverBg } from "../../theme/colors";
import type { PaneProps } from "../../types/plugin";
import type { Portfolio } from "../../types/ticker";
import { apiClient, type AccountProfile } from "../../utils/api-client";
import { isPlainKey } from "../../utils/keyboard";
import { DialogFrame } from "../../components/ui/frame";
import { useDialog, useDialogKeyboard, type AlertContext, type PromptContext } from "../../ui/dialog";
import { CloudAuthNotice } from "./cloud-auth-actions";
import { chatController } from "./chat-controller";

type AccountFieldKey =
  | "username"
  | "name"
  | "company"
  | "title"
  | "bio"
  | "profilePublic"
  | "publicEmail"
  | "xAccount"
  | "acceptUnknownDms"
  | "sharedPortfolioId"
  | "passwordAction";

interface AccountDraft {
  username: string;
  name: string;
  company: string;
  title: string;
  bio: string;
  profilePublic: boolean;
  publicEmail: string;
  xAccount: string;
  sharedPortfolioId: string;
  acceptUnknownDms: boolean;
}

const BASE_FIELD_ORDER: AccountFieldKey[] = [
  "username",
  "name",
  "company",
  "title",
  "bio",
  "profilePublic",
  "publicEmail",
  "xAccount",
  "acceptUnknownDms",
  "sharedPortfolioId",
  "passwordAction",
];

const NO_PORTFOLIO_VALUE = "__none__";

function profileToDraft(profile: AccountProfile | null): AccountDraft {
  return {
    username: profile?.username ?? "",
    name: profile?.name ?? "",
    company: profile?.company ?? "",
    title: profile?.title ?? "",
    bio: profile?.bio ?? "",
    profilePublic: profile?.profilePublic === true,
    publicEmail: profile?.publicEmail ?? "",
    xAccount: profile?.xAccount ?? "",
    sharedPortfolioId: profile?.sharedPortfolioId ?? "",
    acceptUnknownDms: profile?.acceptUnknownDms === true,
  };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function formatPlan(plan: AccountProfile["plan"] | null | undefined): string {
  return plan === "pro" ? "Pro" : "Free";
}

function buildPortfolioChoices(portfolios: Portfolio[], holdingCounts: Record<string, number>): ChoiceDialogChoice[] {
  return [
    { id: NO_PORTFOLIO_VALUE, label: "None", detail: "Off", description: "No public analytics portfolio." },
    ...portfolios.map((portfolio) => ({
      id: portfolio.id,
      label: portfolio.name,
      detail: `${holdingCounts[portfolio.id] ?? 0} tickers`,
      description: portfolio.description || `${portfolio.currency} portfolio`,
    })),
  ];
}

function portfolioOptionIds(portfolios: Portfolio[]): string[] {
  return [NO_PORTFOLIO_VALUE, ...portfolios.map((portfolio) => portfolio.id)];
}

function selectedPortfolioLabel(portfolios: Portfolio[], value: string): string {
  if (!value) return "None";
  return portfolios.find((portfolio) => portfolio.id === value)?.name ?? value;
}

function AccountTextField({
  fieldKey,
  label,
  value,
  placeholder,
  activeField,
  focused,
  width,
  type,
  onFocus,
  onChange,
  onSubmit,
}: {
  fieldKey: AccountFieldKey;
  label: string;
  value: string;
  placeholder?: string;
  activeField: AccountFieldKey;
  focused: boolean;
  width: number;
  type?: "text" | "password";
  onFocus: (field: AccountFieldKey) => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const active = activeField === fieldKey;
  return (
    <Box onMouseDown={() => onFocus(fieldKey)}>
      <TextField
        label={`${active ? "> " : "  "}${label}`}
        value={value}
        placeholder={placeholder}
        focused={focused && active}
        width={width}
        type={type}
        onChange={onChange}
        onSubmit={onSubmit}
        onMouseDown={() => onFocus(fieldKey)}
      />
    </Box>
  );
}

function FieldRow({
  twoColumns,
  children,
}: {
  twoColumns: boolean;
  children: ReactNode;
}) {
  return (
    <Box flexDirection={twoColumns ? "row" : "column"} gap={1}>
      {children}
    </Box>
  );
}

function PickerRow({
  label,
  value,
  detail,
  active,
  width,
  onFocus,
  onOpen,
}: {
  label: string;
  value: string;
  detail?: string;
  active: boolean;
  width: number;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const buttonWidth = Math.max(12, Math.min(32, width - 18));
  const detailWidth = Math.max(0, width - buttonWidth - 4);

  return (
    <Box
      flexDirection="column"
      onMouseMove={onFocus}
      onMouseDown={(event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
        event?.stopPropagation?.();
        event?.preventDefault?.();
        onFocus();
      }}
      onMouseUp={(event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
        event?.stopPropagation?.();
        event?.preventDefault?.();
        onOpen();
      }}
    >
      <Text fg={active ? colors.textBright : colors.textDim} attributes={active ? TextAttributes.BOLD : 0}>
        {active ? `> ${label}` : `  ${label}`}
      </Text>
      <Box height={1} flexDirection="row" gap={1}>
        <Box width={buttonWidth} backgroundColor={active ? colors.selected : colors.panel}>
          <Text fg={active ? colors.selectedText : colors.text}>
            {` ${truncate(value, Math.max(1, buttonWidth - 2))} `}
          </Text>
        </Box>
        {detail ? (
          <Text fg={colors.textMuted}>{truncate(detail, detailWidth)}</Text>
        ) : null}
      </Box>
    </Box>
  );
}

function CheckboxRow({
  label,
  checked,
  active,
  description,
  width,
  onFocus,
  onChange,
}: {
  label: string;
  checked: boolean;
  active: boolean;
  description?: string;
  width: number;
  onFocus: () => void;
  onChange: (checked: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const marker = checked ? "x" : " ";
  const fg = active ? colors.textBright : colors.text;

  return (
    <Box
      flexDirection="column"
      backgroundColor={hovered ? hoverBg() : undefined}
      onMouseMove={() => {
        setHovered(true);
        onFocus();
      }}
      onMouseOut={() => setHovered(false)}
      onMouseDown={() => {
        onFocus();
        onChange(!checked);
      }}
    >
      <Text fg={fg} attributes={active ? TextAttributes.BOLD : 0}>
        {`${active ? "> " : "  "}[${marker}] ${label}`}
      </Text>
      {description ? (
        <Text fg={colors.textMuted} wrapText width={Math.max(24, width - 2)}>
          {description}
        </Text>
      ) : null}
    </Box>
  );
}

type PasswordDialogField = "current" | "new" | "confirm";

function PasswordChangeDialog({
  dismiss,
  onChangePassword,
}: AlertContext & {
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const [activeField, setActiveField] = useState<PasswordDialogField>("current");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldOrder: PasswordDialogField[] = ["current", "new", "confirm"];

  const submit = useCallback(async () => {
    if (submitting) return;
    if (!currentPassword || !newPassword) {
      setError("Current and new password are required.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onChangePassword(currentPassword, newPassword);
      dismiss();
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Failed to change password.");
    } finally {
      setSubmitting(false);
    }
  }, [confirmPassword, currentPassword, dismiss, newPassword, onChangePassword, submitting]);

  const cycleDialogField = useCallback((delta: number) => {
    setActiveField((field) => {
      const index = fieldOrder.indexOf(field);
      return fieldOrder[Math.max(0, Math.min(fieldOrder.length - 1, index + delta))] ?? "current";
    });
  }, []);

  useDialogKeyboard((event) => {
    if (event.name === "escape") {
      event.stopPropagation?.();
      dismiss();
      return;
    }
    if (isPlainKey(event, "tab") || (!event.targetEditable && isPlainKey(event, "down", "j"))) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleDialogField(1);
      return;
    }
    if (!event.targetEditable && isPlainKey(event, "up", "k")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleDialogField(-1);
    }
  }, { allowEditable: true });

  const fieldWidth = 42;
  return (
    <DialogFrame title="Change Password" footer="Esc cancel">
      <Box flexDirection="column" gap={1}>
        <TextField
          label={activeField === "current" ? "> Current Password" : "  Current Password"}
          value={currentPassword}
          focused={activeField === "current"}
          width={fieldWidth}
          type="password"
          onMouseDown={() => setActiveField("current")}
          onChange={setCurrentPassword}
          onSubmit={() => { void submit(); }}
        />
        <TextField
          label={activeField === "new" ? "> New Password" : "  New Password"}
          value={newPassword}
          focused={activeField === "new"}
          width={fieldWidth}
          type="password"
          onMouseDown={() => setActiveField("new")}
          onChange={setNewPassword}
          onSubmit={() => { void submit(); }}
        />
        <TextField
          label={activeField === "confirm" ? "> Confirm Password" : "  Confirm Password"}
          value={confirmPassword}
          focused={activeField === "confirm"}
          width={fieldWidth}
          type="password"
          onMouseDown={() => setActiveField("confirm")}
          onChange={setConfirmPassword}
          onSubmit={() => { void submit(); }}
        />
        {error ? <Text fg={colors.negative}>{truncate(error, fieldWidth)}</Text> : null}
        <Box flexDirection="row" justifyContent="flex-end">
          <Button
            label={submitting ? "Changing..." : "Update Password"}
            variant="primary"
            disabled={submitting}
            onPress={() => { void submit(); }}
          />
        </Box>
      </Box>
    </DialogFrame>
  );
}

export function AccountManagementPane({ focused, width, height }: PaneProps) {
  const dialog = useDialog();
  const portfolios = useAppSelector((state) => state.config.portfolios);
  const tickers = useAppSelector((state) => state.tickers);
  const [sessionMarker, setSessionMarker] = useState(() => {
    const snapshot = chatController.getSnapshot();
    return `${apiClient.getSessionToken() ?? ""}:${snapshot.user?.id ?? ""}:${snapshot.user?.username ?? ""}`;
  });
  const [hasSession, setHasSession] = useState(() => !!apiClient.getSessionToken());
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [draft, setDraft] = useState<AccountDraft>(() => profileToDraft(null));
  const [activeField, setActiveField] = useState<AccountFieldKey>("username");
  const [message, setMessage] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<"profile" | "password" | null>(null);
  const bioRef = useRef<TextareaRenderable | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const formWidth = Math.max(24, Math.min(70, width - 2));
  const twoColumns = formWidth >= 60;
  const fieldWidth = twoColumns ? Math.max(22, Math.floor((formWidth - 3) / 2)) : Math.max(18, Math.min(46, formWidth - 2));
  const fullFieldWidth = Math.max(18, Math.min(54, formWidth - 2));
  const bodyHeight = Math.max(5, height);
  const fieldOrder = BASE_FIELD_ORDER;

  const portfolioHoldingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const record of Object.values(tickers)) {
      for (const portfolioId of record.metadata.portfolios) {
        counts[portfolioId] = (counts[portfolioId] ?? 0) + 1;
      }
    }
    return counts;
  }, [tickers]);
  const portfolioChoices = useMemo(
    () => buildPortfolioChoices(portfolios, portfolioHoldingCounts),
    [portfolioHoldingCounts, portfolios],
  );

  useEffect(() => {
    const unsubscribe = chatController.subscribe((snapshot) => {
      setHasSession(!!apiClient.getSessionToken() || snapshot.hasSavedSession);
      setSessionMarker(`${apiClient.getSessionToken() ?? ""}:${snapshot.user?.id ?? ""}:${snapshot.user?.username ?? ""}`);
    });
    void chatController.refreshSession().catch(() => {});
    return unsubscribe;
  }, []);

  const loadProfile = useCallback(async () => {
    if (!apiClient.getSessionToken()) {
      setProfile(null);
      setDraft(profileToDraft(null));
      return;
    }

    setMessage({ tone: "info", text: "Loading account profile..." });
    try {
      const nextProfile = await apiClient.getAccountProfile();
      setProfile(nextProfile);
      setDraft(profileToDraft(nextProfile));
      setMessage(null);
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to load account profile.",
      });
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile, sessionMarker]);

  useEffect(() => {
    if (!fieldOrder.includes(activeField)) {
      setActiveField("username");
    }
  }, [activeField, fieldOrder]);

  const setDraftValue = useCallback(<K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const openPasswordDialog = useCallback(() => {
    if (busy) return;
    setActiveField("passwordAction");
    void dialog.alert({
      closeOnClickOutside: false,
      content: (context: AlertContext) => (
        <PasswordChangeDialog
          {...context}
          onChangePassword={async (currentPassword, newPassword) => {
            setBusy("password");
            setMessage({ tone: "info", text: "Changing password..." });
            try {
              await apiClient.changePassword(currentPassword, newPassword);
              setMessage({ tone: "success", text: "Password changed." });
            } catch (error) {
              setMessage({
                tone: "error",
                text: error instanceof Error ? error.message : "Failed to change password.",
              });
              throw error;
            } finally {
              setBusy(null);
            }
          }}
        />
      ),
    }).catch(() => {});
  }, [busy, dialog]);

  const openPortfolioDialog = useCallback(async () => {
    setActiveField("sharedPortfolioId");
    const selected = await dialog.prompt<string>({
      closeOnClickOutside: false,
      content: (context: PromptContext<string>) => (
        <ChoiceDialog
          {...context}
          title="Shared Portfolio"
          choices={portfolioChoices}
          footer="↑↓ choose · Enter/click select · Esc cancel"
        />
      ),
    }).catch(() => "");
    if (!selected) return;
    setDraftValue("sharedPortfolioId", selected === NO_PORTFOLIO_VALUE ? "" : selected);
  }, [dialog, portfolioChoices, setDraftValue]);

  const cycleField = useCallback((delta: number) => {
    setActiveField((current) => {
      const index = fieldOrder.indexOf(current);
      const nextIndex = Math.max(0, Math.min(fieldOrder.length - 1, index + delta));
      return fieldOrder[nextIndex] ?? "username";
    });
  }, [fieldOrder]);

  const cyclePortfolio = useCallback((delta: number) => {
    const optionIds = portfolioOptionIds(portfolios);
    const currentValue = draftRef.current.sharedPortfolioId || NO_PORTFOLIO_VALUE;
    const currentIndex = Math.max(0, optionIds.indexOf(currentValue));
    const nextIndex = (currentIndex + delta + optionIds.length) % optionIds.length;
    const nextValue = optionIds[nextIndex] ?? NO_PORTFOLIO_VALUE;
    setDraftValue("sharedPortfolioId", nextValue === NO_PORTFOLIO_VALUE ? "" : nextValue);
  }, [portfolios, setDraftValue]);

  const saveProfile = useCallback(async () => {
    const current = draftRef.current;
    const bio = bioRef.current?.editBuffer.getText() ?? current.bio;
    if (!current.username.trim() || !current.name.trim()) {
      setMessage({ tone: "error", text: "Username and full name are required." });
      return;
    }

    setBusy("profile");
    setMessage({ tone: "info", text: "Saving account profile..." });
    try {
      const nextProfile = await apiClient.updateAccountProfile({
        username: current.username,
        name: current.name,
        company: emptyToNull(current.company),
        title: emptyToNull(current.title),
        bio: emptyToNull(bio),
        profilePublic: current.profilePublic,
        publicEmail: emptyToNull(current.publicEmail),
        xAccount: emptyToNull(current.xAccount),
        sharedPortfolioId: emptyToNull(current.sharedPortfolioId),
        acceptUnknownDms: current.acceptUnknownDms,
      });
      setProfile(nextProfile);
      setDraft(profileToDraft(nextProfile));
      await chatController.refreshSession().catch(() => {});
      setMessage({ tone: "success", text: "Account profile saved." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to save account profile.",
      });
    } finally {
      setBusy(null);
    }
  }, []);

  const footerHints = useMemo<PaneHint[]>(() => [
    { id: "save", key: "Ctrl+S", label: "save", onPress: () => { void saveProfile(); }, disabled: !!busy || !hasSession },
    { id: "password", key: "p", label: "assword", onPress: openPasswordDialog, disabled: !!busy || !hasSession },
  ], [busy, hasSession, openPasswordDialog, saveProfile]);

  usePaneFooter("account-management", () => ({
    info: [
      ...(message ? [{ id: "status", parts: [{ text: message.text, tone: message.tone === "error" ? "negative" as const : message.tone === "success" ? "positive" as const : "muted" as const }] }] : []),
      ...(profile ? [
        { id: "account", parts: [{ text: profile.email, tone: "muted" as const }] },
        { id: "plan", parts: [{ text: formatPlan(profile.plan), tone: profile.plan === "pro" ? "positive" as const : "muted" as const }] },
        { id: "visibility", parts: [{ text: draft.profilePublic ? "public" : "private", tone: "muted" as const }] },
      ] : []),
    ],
    hints: footerHints,
  }), [draft.profilePublic, footerHints, message, profile]);

  useShortcut((event) => {
    if (!focused) return;

    if (event.ctrl && event.name === "s") {
      event.preventDefault?.();
      event.stopPropagation?.();
      void saveProfile();
      return;
    }

    if (isPlainKey(event, "tab") || (!event.targetEditable && isPlainKey(event, "down", "j"))) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleField(1);
      return;
    }
    if (!event.targetEditable && isPlainKey(event, "up", "k")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleField(-1);
      return;
    }
    if (!event.targetEditable && activeField === "profilePublic" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDraftValue("profilePublic", !draftRef.current.profilePublic);
      return;
    }
    if (!event.targetEditable && activeField === "acceptUnknownDms" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDraftValue("acceptUnknownDms", !draftRef.current.acceptUnknownDms);
      return;
    }
    if (!event.targetEditable && activeField === "sharedPortfolioId" && isPlainKey(event, "left", "h", "[")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cyclePortfolio(-1);
      return;
    }
    if (!event.targetEditable && activeField === "sharedPortfolioId" && isPlainKey(event, "right", "l", "]")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cyclePortfolio(1);
      return;
    }
    if (!event.targetEditable && activeField === "sharedPortfolioId" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void openPortfolioDialog();
      return;
    }
    if (!event.targetEditable && activeField === "passwordAction" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openPasswordDialog();
      return;
    }
    if (!event.targetEditable && event.name === "p") {
      event.preventDefault?.();
      event.stopPropagation?.();
      openPasswordDialog();
    }
  }, { allowEditable: true });

  if (!hasSession && !apiClient.getSessionToken()) {
    return (
      <Box padding={1}>
        <CloudAuthNotice message="Log in to manage your Gloomberb Cloud account." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      <ScrollBox height={bodyHeight} scrollY focusable={false}>
        <Box flexDirection="column" width={formWidth} gap={1}>
          <FieldRow twoColumns={twoColumns}>
            <AccountTextField
              fieldKey="username"
              label="Username"
              value={draft.username}
              placeholder="username"
              activeField={activeField}
              focused={focused}
              width={fieldWidth}
              onFocus={setActiveField}
              onChange={(value) => setDraftValue("username", value)}
              onSubmit={() => { void saveProfile(); }}
            />
            <AccountTextField
              fieldKey="name"
              label="Full Name"
              value={draft.name}
              placeholder="Full name"
              activeField={activeField}
              focused={focused}
              width={fieldWidth}
              onFocus={setActiveField}
              onChange={(value) => setDraftValue("name", value)}
              onSubmit={() => { void saveProfile(); }}
            />
          </FieldRow>

          <FieldRow twoColumns={twoColumns}>
            <AccountTextField
              fieldKey="company"
              label="Company"
              value={draft.company}
              placeholder="Company"
              activeField={activeField}
              focused={focused}
              width={fieldWidth}
              onFocus={setActiveField}
              onChange={(value) => setDraftValue("company", value)}
              onSubmit={() => { void saveProfile(); }}
            />
            <AccountTextField
              fieldKey="title"
              label="Title"
              value={draft.title}
              placeholder="Title"
              activeField={activeField}
              focused={focused}
              width={fieldWidth}
              onFocus={setActiveField}
              onChange={(value) => setDraftValue("title", value)}
              onSubmit={() => { void saveProfile(); }}
            />
          </FieldRow>

          <FieldRow twoColumns={twoColumns}>
            <AccountTextField
              fieldKey="publicEmail"
              label="Public Email"
              value={draft.publicEmail}
              placeholder="public@example.com"
              activeField={activeField}
              focused={focused}
              width={fieldWidth}
              onFocus={setActiveField}
              onChange={(value) => setDraftValue("publicEmail", value)}
              onSubmit={() => { void saveProfile(); }}
            />
            <AccountTextField
              fieldKey="xAccount"
              label="X Account"
              value={draft.xAccount}
              placeholder="handle"
              activeField={activeField}
              focused={focused}
              width={fieldWidth}
              onFocus={setActiveField}
              onChange={(value) => setDraftValue("xAccount", value)}
              onSubmit={() => { void saveProfile(); }}
            />
          </FieldRow>

          <Box flexDirection="column" onMouseDown={() => setActiveField("bio")}>
            <Text fg={activeField === "bio" ? colors.textBright : colors.textDim} attributes={activeField === "bio" ? TextAttributes.BOLD : 0}>
              {activeField === "bio" ? "> Bio" : "  Bio"}
            </Text>
            <Box height={3} width={fullFieldWidth} border borderColor={activeField === "bio" ? colors.borderFocused : colors.border} backgroundColor={colors.panel}>
              <Textarea
                key={`bio:${profile?.updatedAt ?? "empty"}`}
                ref={bioRef}
                initialValue={draft.bio}
                placeholder="Short profile bio"
                focused={focused && activeField === "bio"}
                textColor={colors.text}
                placeholderColor={colors.textDim}
                backgroundColor={colors.panel}
                flexGrow={1}
                wrapText
                onInput={(value: string) => setDraftValue("bio", value)}
              />
            </Box>
          </Box>

          <FieldRow twoColumns={twoColumns}>
            <CheckboxRow
              label="Public Profile"
              checked={draft.profilePublic}
              active={activeField === "profilePublic"}
              width={fieldWidth}
              onFocus={() => setActiveField("profilePublic")}
              onChange={(checked) => setDraftValue("profilePublic", checked)}
            />
            <CheckboxRow
              label="Incoming DMs"
              checked={draft.acceptUnknownDms}
              active={activeField === "acceptUnknownDms"}
              width={fieldWidth}
              onFocus={() => setActiveField("acceptUnknownDms")}
              onChange={(checked) => setDraftValue("acceptUnknownDms", checked)}
            />
          </FieldRow>

          <PickerRow
            label="Profile Analytics"
            value={selectedPortfolioLabel(portfolios, draft.sharedPortfolioId)}
            detail={draft.sharedPortfolioId ? "YTD% + beta source" : "No shared portfolio"}
            active={activeField === "sharedPortfolioId"}
            width={formWidth}
            onFocus={() => setActiveField("sharedPortfolioId")}
            onOpen={() => { void openPortfolioDialog(); }}
          />

          <Box flexDirection="row" gap={1}>
            <Button label={busy === "profile" ? "Saving..." : "Save Profile"} variant="primary" onPress={() => { void saveProfile(); }} disabled={!!busy} />
            <Button
              label="Change Password"
              active={activeField === "passwordAction"}
              onPress={openPasswordDialog}
              disabled={!!busy}
            />
          </Box>
          <Box height={1} />
        </Box>
      </ScrollBox>
    </Box>
  );
}
