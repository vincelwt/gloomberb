import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ChoiceDialog } from "../../../components";
import { useAppSelector } from "../../../state/app/context";
import { useChartQueries, useFxRatesMap, useTickerFinancialsMap } from "../../../market-data/hooks";
import { selectEffectiveExchangeRates } from "../../../utils/exchange-rate-map";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, ScrollBox, Text, Textarea, TextAttributes, type TextareaRenderable } from "../../../ui";
import { useDialog, type AlertContext, type PromptContext } from "../../../ui/dialog";
import { apiClient, type AccountProfile } from "../../../api-client";
import { chatController } from "../chat/controller";
import { CloudAuthNotice } from "../cloud/auth-actions";
import {
  AccountAnalyticsPreview,
  AccountTextField,
  CheckboxRow,
  FieldRow,
  PickerRow,
} from "./form-components";
import {
  BASE_FIELD_ORDER,
  NO_PORTFOLIO_VALUE,
  buildProfileAnalyticsPreview,
  buildPortfolioChoices,
  computeCumulativeReturn,
  countPortfolioHoldings,
  emptyToNull,
  getPortfolioPositionTickers,
  portfolioOptionIds,
  profileToDraft,
  selectedPortfolioLabel,
  type AccountDraft,
  type AccountFieldKey,
} from "./model";
import { PasswordChangeDialog } from "./password-dialog";
import { useAccountManagementFooter } from "./footer";
import { useAccountManagementKeyboard } from "./keyboard";
import { usePortfolioAccountState } from "../portfolio-list/header";
import { buildTrackedCurrencies } from "../analytics/sector-model";
import {
  buildBenchmarkReturnSeries,
  buildPortfolioChartTargets,
  buildPortfolioReturnSeries,
} from "../analytics/pane-model";
import { computeDatedBeta } from "../analytics/metrics";
import { useCloudSyncStatus } from "../../../sync/react";

type AccountBusy = "profile" | "password" | "alerts" | null;

function formatSyncStatus(status: ReturnType<typeof useCloudSyncStatus>, profile: AccountProfile | null): string {
  if (!profile?.syncEnabled) return "Off";
  if (status.phase === "syncing") return "Syncing";
  if (status.phase === "error") return status.error ? `Error: ${status.error}` : "Error";
  if (status.lastSyncAt) return `Last sync ${new Date(status.lastSyncAt).toLocaleString()}`;
  if (profile.lastSyncAt) return `Last sync ${new Date(profile.lastSyncAt).toLocaleString()}`;
  if (status.phase === "disabled") return "Waiting for login";
  return "Not synced yet";
}

export function AccountManagementPane({ focused, width, height }: PaneProps) {
  const dialog = useDialog();
  const config = useAppSelector((state) => state.config);
  const portfolios = config.portfolios;
  const baseCurrency = config.baseCurrency;
  const tickers = useAppSelector((state) => state.tickers);
  const cachedFinancials = useAppSelector((state) => state.financials);
  const cachedExchangeRates = useAppSelector((state) => state.exchangeRates);
  const brokerAccounts = useAppSelector((state) => state.brokerAccounts);
  const [sessionMarker, setSessionMarker] = useState(() => {
    const snapshot = chatController.getSnapshot();
    return `${apiClient.getSessionToken() ?? ""}:${snapshot.user?.id ?? ""}:${snapshot.user?.username ?? ""}`;
  });
  const [hasSession, setHasSession] = useState(() => !!apiClient.getSessionToken());
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [draft, setDraft] = useState<AccountDraft>(() => profileToDraft(null));
  const [activeField, setActiveField] = useState<AccountFieldKey>("username");
  const [message, setMessage] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<AccountBusy>(null);
  const syncStatus = useCloudSyncStatus();
  const bioRef = useRef<TextareaRenderable | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const formWidth = Math.max(24, Math.min(70, width - 2));
  const twoColumns = formWidth >= 60;
  const fieldWidth = twoColumns ? Math.max(22, Math.floor((formWidth - 3) / 2)) : Math.max(18, Math.min(46, formWidth - 2));
  const fullFieldWidth = Math.max(18, Math.min(54, formWidth - 2));
  const bodyHeight = Math.max(5, height);
  const fieldOrder = BASE_FIELD_ORDER;

  const portfolioHoldingCounts = useMemo(() => countPortfolioHoldings(tickers), [tickers]);
  const portfolioChoices = useMemo(
    () => buildPortfolioChoices(portfolios, portfolioHoldingCounts),
    [portfolioHoldingCounts, portfolios],
  );
  const selectedAnalyticsPortfolio = useMemo(
    () => portfolios.find((portfolio) => portfolio.id === draft.sharedPortfolioId) ?? null,
    [draft.sharedPortfolioId, portfolios],
  );
  const portfolioTickers = useMemo(
    () => draft.sharedPortfolioId ? getPortfolioPositionTickers(tickers, draft.sharedPortfolioId) : [],
    [draft.sharedPortfolioId, tickers],
  );
  const marketFinancials = useTickerFinancialsMap(portfolioTickers);
  const financials = useMemo(() => {
    const merged = new Map(cachedFinancials);
    for (const [symbol, data] of marketFinancials) {
      merged.set(symbol, data);
    }
    return merged;
  }, [cachedFinancials, marketFinancials]);
  const trackedCurrencies = useMemo(
    () => buildTrackedCurrencies(portfolioTickers, financials, baseCurrency),
    [baseCurrency, financials, portfolioTickers],
  );
  const fetchedExchangeRates = useFxRatesMap(trackedCurrencies);
  const effectiveExchangeRates = selectEffectiveExchangeRates(fetchedExchangeRates, cachedExchangeRates);
  const accountStateInput = useMemo(() => ({ brokerAccounts, config }), [brokerAccounts, config]);
  const accountState = usePortfolioAccountState(selectedAnalyticsPortfolio, accountStateInput);
  const chartTargets = useMemo(
    () => buildPortfolioChartTargets(portfolioTickers),
    [portfolioTickers],
  );
  const chartRequests = useMemo(
    () => chartTargets.map((target) => target.request),
    [chartTargets],
  );
  const chartEntries = useChartQueries(chartRequests);
  const spyRequest = useMemo(
    () => ({
      instrument: { symbol: "SPY", exchange: "" },
      bufferRange: "1Y" as const,
      granularity: "range" as const,
    }),
    [],
  );
  const spyChartRequests = useMemo(
    () => portfolioTickers.length > 0 ? [spyRequest] : [],
    [portfolioTickers.length, spyRequest],
  );
  const spyChartEntries = useChartQueries(spyChartRequests);
  const columnContext = useMemo(() => ({
    activeTab: draft.sharedPortfolioId || undefined,
    baseCurrency,
    exchangeRates: effectiveExchangeRates,
    now: Date.now(),
  }), [baseCurrency, draft.sharedPortfolioId, effectiveExchangeRates]);
  const portfolioReturnSeries = useMemo(
    () => buildPortfolioReturnSeries({
      chartTargets,
      chartEntries,
      financials,
      columnContext,
    }),
    [chartEntries, chartTargets, columnContext, financials],
  );
  const spyReturnSeries = useMemo(
    () => buildBenchmarkReturnSeries(spyRequest, spyChartEntries),
    [spyChartEntries, spyRequest],
  );
  const oneYearReturn = useMemo(
    () => portfolioReturnSeries ? computeCumulativeReturn(portfolioReturnSeries) : null,
    [portfolioReturnSeries],
  );
  const beta = useMemo(
    () => (portfolioReturnSeries && spyReturnSeries ? computeDatedBeta(portfolioReturnSeries, spyReturnSeries) : null),
    [portfolioReturnSeries, spyReturnSeries],
  );
  const analyticsPreview = useMemo(
    () => buildProfileAnalyticsPreview({
      accountState,
      baseCurrency,
      beta,
      config,
      exchangeRates: effectiveExchangeRates,
      financials,
      portfolio: selectedAnalyticsPortfolio,
      portfolioTickers,
      selectedPortfolioId: draft.sharedPortfolioId,
      oneYearReturn,
    }),
    [
      accountState,
      baseCurrency,
      beta,
      config,
      draft.sharedPortfolioId,
      effectiveExchangeRates,
      financials,
      portfolioTickers,
      selectedAnalyticsPortfolio,
      oneYearReturn,
    ],
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
    const currentPortfolioChoiceId = draftRef.current.sharedPortfolioId || NO_PORTFOLIO_VALUE;
    const selected = await dialog.prompt<string>({
      closeOnClickOutside: false,
      content: (context: PromptContext<string>) => (
        <ChoiceDialog
          {...context}
          title="Shared Portfolio"
          choices={portfolioChoices}
          selectedChoiceId={currentPortfolioChoiceId}
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
        syncEnabled: current.syncEnabled,
        weeklyRoundupEnabled: current.weeklyRoundupEnabled,
        positionAlertsEnabled: current.positionAlertsEnabled,
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

  const turnOffEmailAlerts = useCallback(async () => {
    setActiveField("emailAlertsOffAction");
    setBusy("alerts");
    setMessage({ tone: "info", text: "Turning off email alerts..." });
    try {
      const settings = await apiClient.updateSyncSettings({
        weeklyRoundupEnabled: false,
        positionAlertsEnabled: false,
      });
      setDraft((current) => ({
        ...current,
        weeklyRoundupEnabled: settings.weeklyRoundupEnabled,
        positionAlertsEnabled: settings.positionAlertsEnabled,
      }));
      const nextProfile = await apiClient.getAccountProfile().catch(() => null);
      if (nextProfile) setProfile(nextProfile);
      setMessage({ tone: "success", text: "Email alerts are off." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to update alert settings.",
      });
    } finally {
      setBusy(null);
    }
  }, []);

  useAccountManagementFooter({
    busy,
    draft,
    hasSession,
    message,
    openPasswordDialog,
    profile,
    saveProfile,
  });

  useAccountManagementKeyboard({
    activeField,
    cycleField,
    cyclePortfolio,
    draftRef,
    focused,
    openPasswordDialog,
    openPortfolioDialog,
    saveProfile,
    setDraftValue,
    turnOffEmailAlerts,
  });

  if (!hasSession && !apiClient.getSessionToken()) {
    return (
      <Box padding={1}>
        <CloudAuthNotice message="Log in to manage your Gloom Cloud account." />
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
            detail={draft.sharedPortfolioId ? "Preview below uses current market data" : "No public portfolio analytics"}
            active={activeField === "sharedPortfolioId"}
            width={formWidth}
            onFocus={() => setActiveField("sharedPortfolioId")}
            onOpen={() => { void openPortfolioDialog(); }}
          />

          <AccountAnalyticsPreview preview={analyticsPreview} width={formWidth} />

          <Box flexDirection="column" gap={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
              Automatic Sync
            </Text>
            <Text fg={colors.textMuted} wrapText width={Math.max(24, formWidth - 2)}>
              {formatSyncStatus(syncStatus, profile)}
            </Text>
            <FieldRow twoColumns={twoColumns}>
              <CheckboxRow
                label="Cloud Sync"
                checked={draft.syncEnabled}
                active={activeField === "syncEnabled"}
                description="Sync config, portfolios, watchlists, and sanitized positions."
                width={fieldWidth}
                onFocus={() => setActiveField("syncEnabled")}
                onChange={(checked) => setDraftValue("syncEnabled", checked)}
              />
              <CheckboxRow
                label="Weekly Roundup"
                checked={draft.weeklyRoundupEnabled}
                active={activeField === "weeklyRoundupEnabled"}
                description="Friday after market close portfolio and watchlist email."
                width={fieldWidth}
                onFocus={() => setActiveField("weeklyRoundupEnabled")}
                onChange={(checked) => setDraftValue("weeklyRoundupEnabled", checked)}
              />
            </FieldRow>
            <CheckboxRow
              label="Position/Watchlist Alerts"
              checked={draft.positionAlertsEnabled}
              active={activeField === "positionAlertsEnabled"}
              description="Email alerts for large synced position or watchlist jumps."
              width={formWidth}
              onFocus={() => setActiveField("positionAlertsEnabled")}
              onChange={(checked) => setDraftValue("positionAlertsEnabled", checked)}
            />
            <Box flexDirection="row" gap={1}>
              <Button
                label={busy === "alerts" ? "Turning Off..." : "Turn Off Email Alerts"}
                active={activeField === "emailAlertsOffAction"}
                onPress={() => { void turnOffEmailAlerts(); }}
                disabled={!!busy || (!draft.weeklyRoundupEnabled && !draft.positionAlertsEnabled)}
              />
            </Box>
          </Box>

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
