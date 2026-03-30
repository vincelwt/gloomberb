import { Tabs } from "./ui/tabs";

export interface Tab {
  label: string;
  value: string;
}

export interface TabBarProps {
  tabs: Tab[];
  activeValue: string;
  onSelect: (value: string) => void;
  compact?: boolean;
}

export function TabBar({ tabs, activeValue, onSelect, compact }: TabBarProps) {
  return <Tabs tabs={tabs} activeValue={activeValue} onSelect={onSelect} compact={compact} />;
}
