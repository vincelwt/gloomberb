import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { Button, NumberField, SegmentedControl, TextField } from "../../../components";
import {
  PRESERVED_PASSWORD_HINT,
  type BrokerProfileDraft,
} from "../../../brokers/profile-form";
import { colors } from "../../../theme/colors";
import type { BrokerAdapter, BrokerConfigField, BrokerProfileAction } from "../../../types/broker";
import type { BrokerInstanceConfig } from "../../../types/config";
import type { BrokerAccount } from "../../../types/trading";
import { formatCurrency } from "../../../utils/format";
import { formatBrokerUpdatedAt, type BrokerProfileRow } from "./model";
import { isBrokerErrorMessage, stateColor, truncate } from "./table";

export type BrokerEditKey = "label" | "enabled" | string;

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

export function BrokerDetailContent({
  row,
  accounts,
  editDraft,
  editFields,
  activeEditKey,
  busy,
  message,
  width,
  actions,
  onActiveEditKeyChange,
  onDraftLabelChange,
  onDraftEnabledChange,
  onDraftValueChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onConnect,
  onSync,
  onOpenAction,
  onRemove,
}: {
  row: BrokerProfileRow | null;
  accounts: BrokerAccount[];
  editDraft: BrokerProfileDraft | null;
  editFields: BrokerConfigField[];
  activeEditKey: BrokerEditKey;
  busy: string | null;
  message: string | null;
  width: number;
  actions: BrokerProfileAction[];
  onActiveEditKeyChange: (key: BrokerEditKey) => void;
  onDraftLabelChange: (label: string) => void;
  onDraftEnabledChange: (enabled: boolean) => void;
  onDraftValueChange: (key: string, value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onConnect: () => void;
  onSync: () => void;
  onOpenAction: (action: BrokerProfileAction) => void;
  onRemove: () => void;
}) {
  if (!row) return <Box flexGrow={1} />;

  const detailStatusMessage = isBrokerErrorMessage(message) ? message : row.message || "No status message.";

  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column">
        <Text fg={stateColor(row.state)} attributes={TextAttributes.BOLD}>
          {truncate(`${row.label} · ${row.stateLabel}`, width)}
        </Text>
        <Text fg={colors.textDim}>
          {truncate(`${row.brokerName} · ${row.mode} · ${row.id}`, width)}
        </Text>
        <Text
          fg={isBrokerErrorMessage(detailStatusMessage) ? colors.negative : colors.textDim}
          width={width}
          wrapText
        >
          {detailStatusMessage}
        </Text>
        <Text fg={colors.textMuted}>{`Last sync ${formatBrokerUpdatedAt(row.lastSyncedAt)}`}</Text>
        <Text fg={colors.textMuted}>{`Status updated ${formatBrokerUpdatedAt(row.updatedAt)}`}</Text>
        <Box height={1} />

        {editDraft && row.adapter ? (
          <Box flexDirection="column" gap={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Edit Profile</Text>
            <Box onMouseDown={() => onActiveEditKeyChange("label")}>
              <TextField
                label={activeEditKey === "label" ? "> Profile Label" : "  Profile Label"}
                value={editDraft.label}
                focused={activeEditKey === "label"}
                width={34}
                onChange={onDraftLabelChange}
                onSubmit={onSaveEdit}
              />
            </Box>
            <Box flexDirection="column" onMouseDown={() => onActiveEditKeyChange("enabled")}>
              <Text fg={activeEditKey === "enabled" ? colors.textBright : colors.textDim} attributes={activeEditKey === "enabled" ? TextAttributes.BOLD : 0}>
                {activeEditKey === "enabled" ? "> Enabled" : "  Enabled"}
              </Text>
              <SegmentedControl
                value={editDraft.enabled ? "yes" : "no"}
                options={[
                  { label: "Enabled", value: "yes" },
                  { label: "Disabled", value: "no" },
                ]}
                onChange={(value) => onDraftEnabledChange(value === "yes")}
              />
            </Box>
            {editFields.map((field) => (
              <BrokerConfigFieldEditor
                key={field.key}
                field={field}
                draft={editDraft}
                previous={row.instance}
                adapter={row.adapter}
                focused={activeEditKey === field.key}
                onFocus={() => onActiveEditKeyChange(field.key)}
                onChange={onDraftValueChange}
                onSubmit={onSaveEdit}
              />
            ))}
            <Box flexDirection="row" gap={1}>
              <Button label="Save" variant="primary" onPress={onSaveEdit} disabled={!!busy} />
              <Button label="Cancel" variant="secondary" onPress={onCancelEdit} disabled={!!busy} />
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Accounts</Text>
            {accounts.length === 0 ? (
              <Text fg={colors.textDim}>No accounts loaded. Test/connect or sync this profile.</Text>
            ) : accounts.map((account) => (
              <Text key={account.accountId} fg={colors.textDim}>
                {truncate(accountDetail(account), width)}
              </Text>
            ))}
            <Box height={1} />
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Actions</Text>
            <Box flexDirection="row" gap={1}>
              <Button label="Edit" onPress={onStartEdit} disabled={!row.adapter || !!busy} />
              <Button label="Test" onPress={onConnect} disabled={!row.adapter || !!busy} />
              <Button label="Sync" onPress={onSync} disabled={!row.adapter || !!busy} />
            </Box>
            <Box height={1} />
            <Box flexDirection="row" gap={1}>
              {actions.map((action) => (
                <Button
                  key={action.id}
                  label={action.label}
                  onPress={() => onOpenAction(action)}
                  disabled={!!busy || !!action.disabled}
                />
              ))}
              <Button label="Disconnect" variant="danger" onPress={onRemove} disabled={!!busy} />
            </Box>
          </Box>
        )}
      </Box>
    </ScrollBox>
  );
}
