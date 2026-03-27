import { Tabs } from "./ui/tabs";

export interface Tab {
  label: string;
  value: string;
}

export interface TabBarProps {
  tabs: Tab[];
  activeValue: string;
  onSelect: (value: string) => void;
}

export function TabBar({ tabs, activeValue, onSelect }: TabBarProps) {
  return <Tabs tabs={tabs} activeValue={activeValue} onSelect={onSelect} />;
}
