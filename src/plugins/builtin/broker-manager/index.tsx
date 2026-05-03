import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  DataTableStackView,
  NumberField,
  SegmentedControl,
  TextField,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type PaneHint,
} from "../../../components";
import {
  buildBrokerProfileConfig,
  createBrokerProfileDraft,
  getVisibleBrokerConfigFields,
  PRESERVED_PASSWORD_HINT,
  validateBrokerProfileValues,
  type BrokerProfileDraft,
} from "../../../brokers/profile-form";
import { useShortcut } from "../../../react/input";
import {
  useAppDispatch,
  useAppSelector,
} from "../../../state/app-context";
import { colors } from "../../../theme/colors";
import type { BrokerAdapter, BrokerConfigField, BrokerProfileAction } from "../../../types/broker";
import type { BrokerInstanceConfig } from "../../../types/config";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import type { BrokerAccount } from "../../../types/trading";
import { DialogFrame } from "../../../components/ui/frame";
import { useDialog, useDialogKeyboard, type PromptContext } from "../../../ui/dialog";
import { formatCurrency } from "../../../utils/format";
import { usePluginAppActions, usePluginBrokerActions } from "../../plugin-runtime";
import {
  buildBrokerProfileRows,
  formatBrokerUpdatedAt,
  type BrokerDisplayState,
  type BrokerProfileRow,
} from "./model";

type BrokerEditKey = "label" | "enabled" | string;
type BrokerColumnId = "profile" | "status" | "broker" | "mode" | "accounts" | "updated";
type BrokerColumn = DataTableColumn & { id: BrokerColumnId };

function stateColor(state: BrokerDisplayState): string {
  switch (state) {
    case "connected": return colors.positive;
    case "connecting": return "#e5c07b";
    case "error": return colors.negative;
    case "disabled": return colors.textMuted;
    case "unavailable": return colors.negative;
    default: return colors.textDim;
  }
}

function stateGlyph(state: BrokerDisplayState): string {
  switch (state) {
    case "connected": return "*";
    case "connecting": return "~";
    case "error": return "!";
    case "disabled": return "-";
    case "unavailable": return "x";
    default: return "o";
  }
}

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  return value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
}

function isBrokerErrorMessage(message: string | null | undefined): boolean {
  const normalized = message?.toLowerCase() ?? "";
  return normalized.includes("failed") || normalized.includes("required");
}

function ConfirmRemoveBrokerDialog({
  resolve,
  row,
}: PromptContext<boolean> & { row: BrokerProfileRow }) {
  const confirm = useCallback(() => resolve(true), [resolve]);
  const cancel = useCallback(() => resolve(false), [resolve]);

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "enter" || event.name === "return") confirm();
    if (event.name === "escape") cancel();
  });

  return (
    <DialogFrame title="Disconnect broker?" footer="Enter disconnect · Esc cancel">
      <Box flexDirection="column" width={58}>
        <Text fg={colors.text}>{`Remove "${row.label}" and imported broker data?`}</Text>
        <Text fg={colors.textDim}>Broker-managed portfolios, positions, and contracts will be removed.</Text>
        <Box height={1} />
        <Box flexDirection="row" gap={1}>
          <Button label="Disconnect" variant="danger" onPress={confirm} />
          <Button label="Back" variant="secondary" onPress={cancel} />
        </Box>
      </Box>
    </DialogFrame>
  );
}

function brokerFieldLabel(field: BrokerConfigField, focused: boolean): string {
  return focused ? `> ${field.label}` : `  ${field.label}`;
}

function BrokerConfigFieldEditor({
  field,
  draft,
  previous,
  adapter,
  focused,
  onFocus,
  onChange,
  onSubmit,
}: {
  field: BrokerConfigField;
  draft: BrokerProfileDraft;
  previous: BrokerInstanceConfig;
  adapter: BrokerAdapter;
  focused: boolean;
  onFocus: () => void;
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
}) {
  const value = draft.values[field.key] ?? "";
  const previousPassword = field.type === "password"
    ? String(((adapter.toConfigValues?.(previous) ?? previous.config)[field.key] ?? "") || "")
    : "";

  if (field.type === "select") {
    return (
      <Box flexDirection="column" onMouseDown={onFocus}>
        <Text fg={focused ? colors.textBright : colors.textDim} attributes={focused ? TextAttributes.BOLD : 0}>
          {brokerFieldLabel(field, focused)}
        </Text>
        <SegmentedControl
          value={value}
          options={(field.options ?? []).map((option) => ({ label: option.label, value: option.value }))}
          onChange={(nextValue) => onChange(field.key, nextValue)}
        />
      </Box>
    );
  }

  const Field = field.type === "number" ? NumberField : TextField;
  return (
    <Box onMouseDown={onFocus}>
      <Field
        label={brokerFieldLabel(field, focused)}
        value={value}
        focused={focused}
        width={34}
        type={field.type === "password" ? "password" : "text"}
        placeholder={field.type === "password" && previousPassword ? PRESERVED_PASSWORD_HINT : field.placeholder}
        hint={field.placeholder}
        onChange={(nextValue) => onChange(field.key, nextValue)}
        onSubmit={onSubmit}
      />
    </Box>
  );
}

function accountDetail(account: BrokerAccount): string {
  const parts = [
    account.accountId,
    account.netLiquidation != null ? `${formatCurrency(account.netLiquidation, account.currency || "USD")} net liq` : null,
    account.buyingPower != null ? `${formatCurrency(account.buyingPower, account.currency || "USD")} buying power` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function buildBrokerColumns(width: number): BrokerColumn[] {
  const usableWidth = Math.max(48, width - 4);
  const statusWidth = 13;
  const modeWidth = 11;
  const accountWidth = 14;
  const updatedWidth = 9;
  const brokerWidth = usableWidth >= 84 ? 22 : 18;
  const separators = 6;
  const profileWidth = Math.max(
    16,
    usableWidth - statusWidth - modeWidth - accountWidth - updatedWidth - brokerWidth - separators,
  );

  return [
    { id: "profile", label: "PROFILE", width: profileWidth, align: "left" },
    { id: "status", label: "STATUS", width: statusWidth, align: "left" },
    { id: "broker", label: "BROKER", width: brokerWidth, align: "left" },
    { id: "mode", label: "MODE", width: modeWidth, align: "left" },
    { id: "accounts", label: "ACCOUNTS", width: accountWidth, align: "right" },
    { id: "updated", label: "UPDATED", width: updatedWidth, align: "right" },
  ];
}

export function BrokersPane({ focused, width, height }: PaneProps) {
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const brokerAccounts = useAppSelector((state) => state.brokerAccounts);
  const dialog = useDialog();
  const { openCommandBar, showWidget } = usePluginAppActions();
  const {
    getBrokerAdapter,
    connectBrokerInstance,
    updateBrokerInstance,
    syncBrokerInstance,
    removeBrokerInstance,
  } = usePluginBrokerActions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editDraft, setEditDraft] = useState<BrokerProfileDraft | null>(null);
  const [activeEditKey, setActiveEditKey] = useState<BrokerEditKey>("label");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusVersion, setStatusVersion] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);

  const adapters = useMemo(() => {
    const next = new Map<string, BrokerAdapter | null>();
    for (const instance of config.brokerInstances) {
      if (!next.has(instance.brokerType)) next.set(instance.brokerType, getBrokerAdapter(instance.brokerType));
    }
    return next;
  }, [config.brokerInstances, getBrokerAdapter]);

  useEffect(() => {
    const disposers = config.brokerInstances.flatMap((instance) => {
      const adapter = getBrokerAdapter(instance.brokerType);
      const dispose = adapter?.subscribeStatus?.(instance, () => setStatusVersion((version) => version + 1));
      return dispose ? [dispose] : [];
    });
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [config.brokerInstances, getBrokerAdapter]);

  const rows = useMemo(
    () => buildBrokerProfileRows(config, adapters, brokerAccounts),
    [adapters, brokerAccounts, config, statusVersion],
  );
  const selectedRow = rows[Math.min(selectedIndex, rows.length - 1)] ?? null;
  const selectedAccounts = selectedRow ? brokerAccounts[selectedRow.id] ?? [] : [];
  const editFields = editDraft && selectedRow?.adapter
    ? getVisibleBrokerConfigFields(selectedRow.adapter, editDraft.values)
    : [];
  const editKeys = useMemo<BrokerEditKey[]>(
    () => ["label", "enabled", ...editFields.map((field) => field.key)],
    [editFields],
  );

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(current, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    if (rows.length === 0) {
      setDetailOpen(false);
    }
  }, [rows.length]);

  useEffect(() => {
    if (!editDraft) return;
    if (!editKeys.includes(activeEditKey)) setActiveEditKey(editKeys[0] ?? "label");
  }, [activeEditKey, editDraft, editKeys]);

  useEffect(() => {
    if (!focused || !editDraft) return;
    dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
    return () => {
      dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
    };
  }, [dispatch, editDraft, focused]);

  const openAddBroker = useCallback(() => {
    openCommandBar("Add Broker Account");
  }, [openCommandBar]);

  const startEdit = useCallback(() => {
    if (!selectedRow?.adapter) {
      setMessage("Broker plugin is not available.");
      return;
    }
    const draft = createBrokerProfileDraft(selectedRow.adapter, selectedRow.instance);
    for (const field of selectedRow.adapter.configSchema) {
      if (field.type === "password" && draft.values[field.key]) draft.values[field.key] = "";
    }
    setEditDraft(draft);
    setActiveEditKey("label");
    setMessage(null);
    setDetailOpen(true);
  }, [selectedRow]);

  const saveEdit = useCallback(async () => {
    if (!selectedRow?.adapter || !editDraft) return;
    const label = editDraft.label.trim();
    if (!label) {
      setMessage("Profile label is required.");
      return;
    }
    const validationError = validateBrokerProfileValues(selectedRow.adapter, editDraft.values, selectedRow.instance);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    try {
      setBusy("Saving…");
      const nextConfig = buildBrokerProfileConfig(selectedRow.adapter, editDraft.values, selectedRow.instance);
      await updateBrokerInstance(selectedRow.id, nextConfig, {
        label,
        enabled: editDraft.enabled,
        replaceConfig: true,
      });
      setEditDraft(null);
      setMessage(`Saved ${label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save broker profile.");
    } finally {
      setBusy(null);
    }
  }, [editDraft, selectedRow, updateBrokerInstance]);

  const connectSelected = useCallback(async () => {
    if (!selectedRow) return;
    try {
      setBusy("Testing…");
      await connectBrokerInstance(selectedRow.id);
      setStatusVersion((version) => version + 1);
      setMessage(`Tested ${selectedRow.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to test ${selectedRow.label}.`);
    } finally {
      setBusy(null);
    }
  }, [connectBrokerInstance, selectedRow]);

  const syncSelected = useCallback(async () => {
    if (!selectedRow) return;
    try {
      setBusy("Syncing…");
      await syncBrokerInstance(selectedRow.id);
      setStatusVersion((version) => version + 1);
      setMessage(`Synced ${selectedRow.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to sync ${selectedRow.label}.`);
    } finally {
      setBusy(null);
    }
  }, [selectedRow, syncBrokerInstance]);

  const selectedProfileActions = useMemo(
    () => selectedRow?.adapter?.getProfileActions?.(selectedRow.instance) ?? [],
    [selectedRow],
  );
  const primaryProfileAction = selectedProfileActions[0] ?? null;

  const openProfileAction = useCallback((action: BrokerProfileAction | null = primaryProfileAction) => {
    if (!action) return;
    if (action.disabled) {
      setMessage(action.disabledReason ?? `${action.label} is unavailable for this profile.`);
      return;
    }
    if (action.widgetId) showWidget(action.widgetId);
  }, [primaryProfileAction, showWidget]);

  const removeSelected = useCallback(async () => {
    if (!selectedRow) return;
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (ctx: PromptContext<boolean>) => (
        <ConfirmRemoveBrokerDialog {...ctx} row={selectedRow} />
      ),
    }).catch(() => false);
    if (confirmed !== true) return;

    try {
      setBusy("Disconnecting…");
      await removeBrokerInstance(selectedRow.id);
      setEditDraft(null);
      setDetailOpen(false);
      setMessage(`Removed ${selectedRow.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to remove ${selectedRow.label}.`);
    } finally {
      setBusy(null);
    }
  }, [dialog, removeBrokerInstance, selectedRow]);

  const hasSelectedRow = selectedRow !== null;
  const selectedHasAdapter = !!selectedRow?.adapter;
  const canUseSelectedBroker = selectedHasAdapter && !busy;
  const canOpenSelectedAction = selectedProfileActions.some((action) => !action.disabled && action.widgetId);
  const canRemoveSelected = hasSelectedRow && !busy;

  const footerActionsRef = useRef({
    openAddBroker,
    startEdit,
    connectSelected,
    syncSelected,
    openProfileAction,
    removeSelected,
    saveEdit,
  });
  footerActionsRef.current = {
    openAddBroker,
    startEdit,
    connectSelected,
    syncSelected,
    openProfileAction,
    removeSelected,
    saveEdit,
  };

  const footerHints = useMemo<PaneHint[]>(() => {
    if (editDraft) {
      return [
        { id: "save", key: "enter", label: "save", onPress: () => footerActionsRef.current.saveEdit().catch(() => {}) },
        { id: "cancel", key: "esc", label: "cancel", onPress: () => setEditDraft(null) },
      ];
    }

    const hints: PaneHint[] = [
      { id: "add", key: "a", label: "dd", onPress: () => footerActionsRef.current.openAddBroker() },
    ];
    if (canUseSelectedBroker) {
      hints.push(
        { id: "edit", key: "e", label: "dit", onPress: () => footerActionsRef.current.startEdit() },
        { id: "connect", key: "c", label: "onnect", onPress: () => footerActionsRef.current.connectSelected().catch(() => {}) },
        { id: "sync", key: "s", label: "ync", onPress: () => footerActionsRef.current.syncSelected().catch(() => {}) },
      );
    }
    if (canOpenSelectedAction) {
      hints.push({ id: "open", key: "o", label: "pen", onPress: () => footerActionsRef.current.openProfileAction() });
    }
    if (canRemoveSelected) {
      hints.push({ id: "disconnect", key: "d", label: "isconnect", onPress: () => footerActionsRef.current.removeSelected().catch(() => {}) });
    }
    return hints;
  }, [canOpenSelectedAction, canRemoveSelected, canUseSelectedBroker, editDraft]);

  usePaneFooter("broker-manager", () => ({
    hints: footerHints,
  }), [footerHints]);

  useShortcut((event) => {
    if (!focused) return;

    if (editDraft) {
      if (event.name === "escape") {
        event.stopPropagation();
        setEditDraft(null);
        return;
      }
      if (event.name === "enter" || event.name === "return") {
        event.stopPropagation();
        saveEdit().catch(() => {});
        return;
      }
      if (event.name === "up" || event.name === "k") {
        event.stopPropagation();
        const index = editKeys.indexOf(activeEditKey);
        setActiveEditKey(editKeys[Math.max(0, index - 1)] ?? "label");
        return;
      }
      if (event.name === "down" || event.name === "j" || event.name === "tab") {
        event.stopPropagation();
        const index = editKeys.indexOf(activeEditKey);
        setActiveEditKey(editKeys[Math.min(editKeys.length - 1, index + 1)] ?? "label");
        return;
      }
      return;
    }

    switch (event.name) {
      case "a":
        openAddBroker();
        break;
      case "e":
        if (canUseSelectedBroker) startEdit();
        break;
      case "c":
        if (canUseSelectedBroker) connectSelected().catch(() => {});
        break;
      case "s":
        if (canUseSelectedBroker) syncSelected().catch(() => {});
        break;
      case "o":
        if (canOpenSelectedAction) openProfileAction();
        break;
      case "d":
        if (canRemoveSelected) removeSelected().catch(() => {});
        break;
    }
  });

  const connectedCount = rows.filter((row) => row.state === "connected").length;
  const errorCount = rows.filter((row) => row.state === "error" || row.state === "unavailable").length;
  const bodyHeight = Math.max(5, height - 4);
  const tableWidth = Math.max(24, width - 2);
  const columns = useMemo(() => buildBrokerColumns(tableWidth), [tableWidth]);

  const renderCell = useCallback((
    row: BrokerProfileRow,
    column: BrokerColumn,
  ): DataTableCell => {
    switch (column.id) {
      case "profile":
        return {
          text: row.label,
          color: colors.text,
          attributes: TextAttributes.BOLD,
        };
      case "status":
        return {
          text: `${stateGlyph(row.state)} ${row.stateLabel}`,
          color: stateColor(row.state),
        };
      case "broker":
        return { text: row.brokerName, color: colors.textDim };
      case "mode":
        return { text: row.mode, color: colors.textDim };
      case "accounts":
        return { text: row.accountSummary, color: row.accountCount > 0 ? colors.text : colors.textMuted };
      case "updated":
        return { text: formatBrokerUpdatedAt(row.updatedAt), color: colors.textMuted };
    }
    return { text: "" };
  }, []);

  const openSelectedDetail = useCallback((index: number, _row: BrokerProfileRow) => {
    setSelectedIndex(index);
    setEditDraft(null);
    setDetailOpen(true);
  }, []);

  const selectBrokerRow = useCallback((index: number, row: BrokerProfileRow) => {
    setSelectedIndex(index);
    if (selectedRow?.id !== row.id) {
      setEditDraft(null);
    }
  }, [selectedRow?.id]);

  const updateDraftValue = (key: string, value: string) => {
    setEditDraft((current) => current
      ? { ...current, values: { ...current.values, [key]: value } }
      : current);
  };

  const detailContentWidth = Math.max(24, tableWidth - 2);
  const detailStatusMessage = selectedRow
    ? isBrokerErrorMessage(message) ? message : selectedRow.message || "No status message."
    : null;
  const detailContent = selectedRow ? (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column">
        <Text fg={stateColor(selectedRow.state)} attributes={TextAttributes.BOLD}>
          {truncate(`${selectedRow.label} · ${selectedRow.stateLabel}`, detailContentWidth)}
        </Text>
        <Text fg={colors.textDim}>
          {truncate(`${selectedRow.brokerName} · ${selectedRow.mode} · ${selectedRow.id}`, detailContentWidth)}
        </Text>
        <Text
          fg={isBrokerErrorMessage(detailStatusMessage) ? colors.negative : colors.textDim}
          width={detailContentWidth}
          wrapText
        >
          {detailStatusMessage}
        </Text>
        <Text fg={colors.textMuted}>{`Updated ${formatBrokerUpdatedAt(selectedRow.updatedAt)}`}</Text>
        <Box height={1} />

        {editDraft && selectedRow.adapter ? (
          <Box flexDirection="column" gap={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Edit Profile</Text>
            <Box onMouseDown={() => setActiveEditKey("label")}>
              <TextField
                label={activeEditKey === "label" ? "> Profile Label" : "  Profile Label"}
                value={editDraft.label}
                focused={activeEditKey === "label"}
                width={34}
                onChange={(label) => setEditDraft((current) => current ? { ...current, label } : current)}
                onSubmit={() => saveEdit().catch(() => {})}
              />
            </Box>
            <Box flexDirection="column" onMouseDown={() => setActiveEditKey("enabled")}>
              <Text fg={activeEditKey === "enabled" ? colors.textBright : colors.textDim} attributes={activeEditKey === "enabled" ? TextAttributes.BOLD : 0}>
                {activeEditKey === "enabled" ? "> Enabled" : "  Enabled"}
              </Text>
              <SegmentedControl
                value={editDraft.enabled ? "yes" : "no"}
                options={[
                  { label: "Enabled", value: "yes" },
                  { label: "Disabled", value: "no" },
                ]}
                onChange={(value) => setEditDraft((current) => current ? { ...current, enabled: value === "yes" } : current)}
              />
            </Box>
            {editFields.map((field) => (
              <BrokerConfigFieldEditor
                key={field.key}
                field={field}
                draft={editDraft}
                previous={selectedRow.instance}
                adapter={selectedRow.adapter}
                focused={activeEditKey === field.key}
                onFocus={() => setActiveEditKey(field.key)}
                onChange={updateDraftValue}
                onSubmit={() => saveEdit().catch(() => {})}
              />
            ))}
            <Box flexDirection="row" gap={1}>
              <Button label="Save" variant="primary" onPress={() => saveEdit().catch(() => {})} disabled={!!busy} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditDraft(null)} disabled={!!busy} />
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Accounts</Text>
            {selectedAccounts.length === 0 ? (
              <Text fg={colors.textDim}>No accounts loaded. Test/connect or sync this profile.</Text>
            ) : selectedAccounts.map((account) => (
              <Text key={account.accountId} fg={colors.textDim}>
                {truncate(accountDetail(account), detailContentWidth)}
              </Text>
            ))}
            <Box height={1} />
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Actions</Text>
            <Box flexDirection="row" gap={1}>
              <Button label="Edit" onPress={startEdit} disabled={!selectedRow.adapter || !!busy} />
              <Button label="Test" onPress={() => connectSelected().catch(() => {})} disabled={!selectedRow.adapter || !!busy} />
              <Button label="Sync" onPress={() => syncSelected().catch(() => {})} disabled={!selectedRow.adapter || !!busy} />
            </Box>
            <Box height={1} />
            <Box flexDirection="row" gap={1}>
              {selectedProfileActions.map((action) => (
                <Button
                  key={action.id}
                  label={action.label}
                  onPress={() => openProfileAction(action)}
                  disabled={!!busy || !!action.disabled}
                />
              ))}
              <Button label="Disconnect" variant="danger" onPress={() => removeSelected().catch(() => {})} disabled={!!busy} />
            </Box>
          </Box>
        )}
      </Box>
    </ScrollBox>
  ) : (
    <Box flexGrow={1} />
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box height={1} flexDirection="row">
        <Box flexGrow={1} flexDirection="row">
          <Box width={8}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Brokers</Text>
          </Box>
          <Text fg={colors.textDim}>{`${rows.length} profiles · ${connectedCount} connected · ${errorCount} issues`}</Text>
        </Box>
        {busy && <Text fg={colors.textDim}>{busy}</Text>}
      </Box>
      <Box height={1}>
        <Text fg={isBrokerErrorMessage(message) ? colors.negative : colors.textDim}>
          {message || "Manage broker profiles, connection tests, and position syncs."}
        </Text>
      </Box>
      <Box height={1}>
        <Text fg={colors.border}>{"─".repeat(Math.max(1, width - 2))}</Text>
      </Box>

      <Box height={bodyHeight} overflow="hidden">
        <DataTableStackView<BrokerProfileRow, BrokerColumn>
          focused={focused}
          detailOpen={detailOpen && !!selectedRow}
          onBack={() => {
            setEditDraft(null);
            setDetailOpen(false);
          }}
          detailContent={detailContent}
          detailTitle={selectedRow?.label}
          rootWidth={tableWidth}
          rootHeight={bodyHeight}
          selectedIndex={Math.min(selectedIndex, Math.max(0, rows.length - 1))}
          onSelectIndex={selectBrokerRow}
          onActivateIndex={openSelectedDetail}
          columns={columns}
          items={rows}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => {}}
          getItemKey={(row) => row.id}
          isSelected={(row) => selectedRow?.id === row.id}
          onSelect={(row, index) => selectBrokerRow(index, row)}
          onActivate={(row, index) => openSelectedDetail(index, row)}
          renderCell={renderCell}
          emptyStateTitle="No broker profiles."
          emptyStateHint="Add a broker profile to test connections and sync positions."
          showHorizontalScrollbar={false}
        />
      </Box>
    </Box>
  );
}

export const brokerManagerPlugin: GloomPlugin = {
  id: "broker-manager",
  name: "Broker Manager",
  version: "1.0.0",
  description: "Manage broker profiles and connection status",
  panes: [
    {
      id: "brokers",
      name: "Brokers",
      icon: "B",
      component: BrokersPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 24 },
    },
  ],
  paneTemplates: [
    {
      id: "brokers-pane",
      paneId: "brokers",
      label: "Brokers",
      description: "Open broker profiles and connection status",
      keywords: ["broker", "brokers", "connection", "status"],
      shortcut: { prefix: "BR" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup(ctx) {
    ctx.registerCommand({
      id: "open-brokers",
      label: "Open Brokers",
      description: "Manage broker profiles and connection status",
      keywords: ["broker", "brokers", "connection", "accounts", "sync"],
      category: "navigation",
      execute: () => {
        ctx.showWidget("brokers");
      },
    });
  },
};
