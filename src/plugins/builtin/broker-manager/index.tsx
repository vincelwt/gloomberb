import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, NumberField, SegmentedControl, TextField, usePaneFooter } from "../../../components";
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
import { colors, hoverBg } from "../../../theme/colors";
import type { BrokerAdapter, BrokerConfigField } from "../../../types/broker";
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<BrokerProfileDraft | null>(null);
  const [activeEditKey, setActiveEditKey] = useState<BrokerEditKey>("label");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusVersion, setStatusVersion] = useState(0);

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

  const openConsole = useCallback(() => {
    if (!selectedRow || selectedRow.brokerType !== "ibkr" || selectedRow.mode.toLowerCase() !== "gateway") {
      setMessage("IBKR Console is available for Gateway / TWS profiles.");
      return;
    }
    showWidget("ibkr-trading");
  }, [selectedRow, showWidget]);

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
      setMessage(`Removed ${selectedRow.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to remove ${selectedRow.label}.`);
    } finally {
      setBusy(null);
    }
  }, [dialog, removeBrokerInstance, selectedRow]);

  const footerActionsRef = useRef({
    openAddBroker,
    startEdit,
    connectSelected,
    syncSelected,
    openConsole,
    removeSelected,
    saveEdit,
  });
  footerActionsRef.current = {
    openAddBroker,
    startEdit,
    connectSelected,
    syncSelected,
    openConsole,
    removeSelected,
    saveEdit,
  };

  usePaneFooter("broker-manager", () => ({
    hints: editDraft
      ? [
        { id: "save", key: "enter", label: "save", onPress: () => footerActionsRef.current.saveEdit().catch(() => {}) },
        { id: "cancel", key: "esc", label: "cancel", onPress: () => setEditDraft(null) },
      ]
      : [
        { id: "add", key: "a", label: "dd", onPress: () => footerActionsRef.current.openAddBroker() },
        { id: "edit", key: "e", label: "dit", onPress: () => footerActionsRef.current.startEdit() },
        { id: "connect", key: "c", label: "onnect", onPress: () => footerActionsRef.current.connectSelected().catch(() => {}) },
        { id: "sync", key: "s", label: "ync", onPress: () => footerActionsRef.current.syncSelected().catch(() => {}) },
        { id: "open", key: "o", label: "pen", onPress: () => footerActionsRef.current.openConsole() },
        { id: "disconnect", key: "d", label: "isconnect", onPress: () => footerActionsRef.current.removeSelected().catch(() => {}) },
      ],
  }), [editDraft]);

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

    if (event.name === "j" || event.name === "down") {
      event.stopPropagation();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (event.name === "k" || event.name === "up") {
      event.stopPropagation();
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }
    switch (event.name) {
      case "a":
        openAddBroker();
        break;
      case "e":
        startEdit();
        break;
      case "c":
        connectSelected().catch(() => {});
        break;
      case "s":
        syncSelected().catch(() => {});
        break;
      case "o":
        openConsole();
        break;
      case "d":
        removeSelected().catch(() => {});
        break;
    }
  });

  const connectedCount = rows.filter((row) => row.state === "connected").length;
  const errorCount = rows.filter((row) => row.state === "error" || row.state === "unavailable").length;
  const listWidth = Math.max(34, Math.floor(width * 0.42));
  const detailWidth = Math.max(34, width - listWidth - 2);
  const bodyHeight = Math.max(5, height - 4);

  const updateDraftValue = (key: string, value: string) => {
    setEditDraft((current) => current
      ? { ...current, values: { ...current.values, [key]: value } }
      : current);
  };

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
        <Text fg={message?.toLowerCase().includes("failed") || message?.toLowerCase().includes("required") ? colors.negative : colors.textDim}>
          {message || "Manage broker profiles, connection tests, and position syncs."}
        </Text>
      </Box>
      <Box height={1}>
        <Text fg={colors.border}>{"─".repeat(Math.max(1, width - 2))}</Text>
      </Box>

      {rows.length === 0 ? (
        <Box flexDirection="column" flexGrow={1}>
          <EmptyState title="No broker profiles." message="Add a broker profile to test connections and sync positions." hint="Press a or click Add Broker." />
          <Box height={1} />
          <Button label="Add Broker" variant="primary" onPress={openAddBroker} />
        </Box>
      ) : (
        <Box flexDirection="row" height={bodyHeight}>
          <Box width={listWidth} flexDirection="column">
            <ScrollBox flexGrow={1} scrollY>
              {rows.map((row, index) => {
                const selected = index === selectedIndex;
                const hovered = index === hoveredIndex && !selected;
                const bg = selected ? colors.selected : hovered ? hoverBg() : colors.bg;
                return (
                  <Box
                    key={row.id}
                    height={3}
                    flexDirection="column"
                    backgroundColor={bg}
                    onMouseMove={() => setHoveredIndex(index)}
                    onMouseDown={() => {
                      setSelectedIndex(index);
                      setEditDraft(null);
                    }}
                  >
                    <Box height={1}>
                      <Text fg={stateColor(row.state)}>{`${stateGlyph(row.state)} `}</Text>
                      <Text fg={selected ? colors.selectedText : colors.text} attributes={selected ? TextAttributes.BOLD : 0}>
                        {truncate(row.label, Math.max(8, listWidth - 18))}
                      </Text>
                      <Text fg={colors.textDim}>{` ${row.stateLabel}`}</Text>
                    </Box>
                    <Text fg={colors.textDim}>{`  ${row.brokerName} · ${row.mode}`}</Text>
                    <Text fg={colors.textMuted}>{`  ${row.accountSummary} · ${formatBrokerUpdatedAt(row.updatedAt)}`}</Text>
                  </Box>
                );
              })}
            </ScrollBox>
          </Box>
          <Box width={1}>
            <Text fg={colors.border}>│</Text>
          </Box>
          <Box width={detailWidth} flexDirection="column" paddingLeft={1}>
            {selectedRow && (
              <ScrollBox flexGrow={1} scrollY>
                <Box flexDirection="column">
                  <Text fg={stateColor(selectedRow.state)} attributes={TextAttributes.BOLD}>
                    {`${selectedRow.label} · ${selectedRow.stateLabel}`}
                  </Text>
                  <Text fg={colors.textDim}>{`${selectedRow.brokerName} · ${selectedRow.mode} · ${selectedRow.id}`}</Text>
                  <Text fg={selectedRow.message ? colors.textDim : colors.textMuted}>{selectedRow.message || "No status message."}</Text>
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
                        <Text key={account.accountId} fg={colors.textDim}>{accountDetail(account)}</Text>
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
                        <Button label="IBKR Console" onPress={openConsole} disabled={selectedRow.brokerType !== "ibkr" || selectedRow.mode.toLowerCase() !== "gateway"} />
                        <Button label="Disconnect" variant="danger" onPress={() => removeSelected().catch(() => {})} disabled={!!busy} />
                      </Box>
                    </Box>
                  )}
                </Box>
              </ScrollBox>
            )}
          </Box>
        </Box>
      )}
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
      keywords: ["broker", "brokers", "ibkr", "connection", "status"],
      shortcut: { prefix: "BR" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup(ctx) {
    ctx.registerCommand({
      id: "open-brokers",
      label: "Open Brokers",
      description: "Manage broker profiles and connection status",
      keywords: ["broker", "brokers", "ibkr", "connection", "accounts", "sync"],
      category: "navigation",
      execute: () => {
        ctx.showWidget("brokers");
      },
    });
  },
};
