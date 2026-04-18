import { Tabs } from "./ui/tabs";

export interface Tab {
  label: string;
  value: string;
  disabled?: boolean;
  onClose?: (value: string) => void;
  onDoubleClick?: (value: string) => void;
  onContextMenu?: (value: string, event: any) => void;
}

export interface TabBarProps {
  tabs: Tab[];
  activeValue: string | null;
  onSelect: (value: string) => void;
  compact?: boolean;
  variant?: "underline" | "pill" | "bare";
  closeMode?: "active" | "always";
  addLabel?: string;
  onAdd?: () => void;
}

export function TabBar({
  tabs,
  activeValue,
  onSelect,
  compact,
  variant,
  closeMode,
  addLabel,
  onAdd,
}: TabBarProps) {
  return (
    <Tabs
      tabs={tabs}
      activeValue={activeValue}
      onSelect={onSelect}
      compact={compact}
      variant={variant}
      closeMode={closeMode}
      addLabel={addLabel}
      onAdd={onAdd}
    />
  );
}
